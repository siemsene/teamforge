import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { signInAnonymously } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { getPublicConfig, getStudentByHash, submitResponse, withdrawResponse } from "../../lib/db";
import { hashCode, normalizeCode } from "../../lib/codes";
import { eciesEncrypt } from "../../lib/crypto";
import type { PublicConfig, StudentDoc, SurveyAnswers } from "../../types";
import { Button, Card, ConfirmDialog, ErrorText, Field, Input, Spinner } from "../../components/ui";
import { SurveyForm } from "./SurveyForm";
import { StudentHub } from "./StudentHub";

type Stage =
  | { name: "loading" }
  | { name: "error"; message: string }
  | { name: "code"; config: PublicConfig }
  | { name: "hub"; config: PublicConfig; hash: string; code: string; student: StudentDoc }
  | { name: "survey"; config: PublicConfig; hash: string; student: StudentDoc }
  | { name: "done"; config: PublicConfig; hash: string; resubmit: boolean };

export function StudentPage() {
  const { sid } = useParams<{ sid: string }>();
  const [stage, setStage] = useState<Stage>({ name: "loading" });

  useEffect(() => {
    if (!sid) return;
    (async () => {
      try {
        // Anonymous auth satisfies security rules without identifying anyone.
        if (!auth.currentUser) await signInAnonymously(auth);
        const config = await getPublicConfig(sid);
        if (!config) {
          setStage({ name: "error", message: "This survey link is not valid (session not found)." });
          return;
        }
        setStage({ name: "code", config });
      } catch (err) {
        setStage({ name: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [sid]);

  if (!sid) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
      {stage.name === "loading" && <Spinner label="Loading survey…" />}
      {stage.name === "error" && (
        <Card>
          <ErrorText>{stage.message}</ErrorText>
        </Card>
      )}
      {stage.name === "code" && (
        <CodeEntry
          sid={sid}
          config={stage.config}
          onEnter={(hash, code, student) =>
            setStage(
              stage.config.teamMgmt?.enabled
                ? { name: "hub", config: stage.config, hash, code, student }
                : { name: "survey", config: stage.config, hash, student },
            )
          }
        />
      )}
      {stage.name === "hub" && (
        <StudentHub sid={sid} config={stage.config} hash={stage.hash} code={stage.code} student={stage.student} />
      )}
      {stage.name === "survey" && (
        <SurveyStage
          sid={sid}
          config={stage.config}
          hash={stage.hash}
          student={stage.student}
          onDone={(resubmit) => setStage({ name: "done", config: stage.config, hash: stage.hash, resubmit })}
        />
      )}
      {stage.name === "done" && (
        <Card>
          <h2 className="mb-2 text-lg font-semibold text-green-700">
            {stage.resubmit ? "Response updated" : "Response submitted"} ✓
          </h2>
          <p className="text-sm text-slate-600">
            Thank you! Your answers were encrypted in your browser before upload — only your instructor can read
            them. While the survey remains open you can return with your code to change or withdraw your response.
          </p>
        </Card>
      )}
    </div>
  );
}

function CodeEntry({
  sid,
  config,
  onEnter,
}: {
  sid: string;
  config: PublicConfig;
  onEnter: (hash: string, code: string, student: StudentDoc) => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (normalizeCode(code).length < 8) return setError("That code looks too short — please check it.");
    setBusy(true);
    try {
      const hash = await hashCode(code);
      const student = await getStudentByHash(sid, hash);
      if (!student) {
        setError("Code not recognized. Check for typos, or ask your instructor.");
        return;
      }
      onEnter(hash, code, student);
    } catch {
      setError("Could not verify the code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <h1 className="mb-1 text-xl font-bold">{config.title}</h1>
        <p className="text-sm text-slate-600">Team formation survey</p>
      </Card>
      <Card className="bg-indigo-50">
        <h2 className="mb-1 font-semibold">Your privacy</h2>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{config.privacyNote}</p>
      </Card>
      <Card>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Your login code" hint="From the email your instructor sent you, e.g. ABC12-DE345.">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXXX-XXXXX"
              autoFocus
              className="font-mono uppercase"
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Continue"}
          </Button>
        </form>
      </Card>
      <p className="text-center text-xs text-slate-500">
        New here?{" "}
        <a
          className="text-indigo-600 hover:underline"
          href="/student-guide.pdf"
          target="_blank"
          rel="noopener noreferrer"
        >
          Read the student quick guide (PDF)
        </a>
      </p>
    </>
  );
}

function SurveyStage({
  sid,
  config,
  hash,
  student,
  onDone,
}: {
  sid: string;
  config: PublicConfig;
  hash: string;
  student: StudentDoc;
  onDone: (resubmit: boolean) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const alreadySubmitted = !!student.submittedAt;

  if (config.status !== "open") {
    return (
      <Card>
        <p className="text-sm text-slate-600">
          {config.status === "draft"
            ? "This survey is not open yet — your instructor is still setting it up. Please come back later."
            : "This survey has closed. Contact your instructor if you still need to respond."}
        </p>
      </Card>
    );
  }

  async function submit(answers: SurveyAnswers) {
    setBusy(true);
    setError("");
    try {
      const payload = await eciesEncrypt(config.publicKeyJwk, JSON.stringify(answers));
      await submitResponse(sid, hash, payload);
      onDone(alreadySubmitted);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    try {
      await withdrawResponse(sid, hash);
      onDone(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      setConfirmWithdraw(false);
    }
  }

  const showsTeammates = config.questions.some((q) => q.kind === "teammates");

  return (
    <>
      <Card>
        <h1 className="text-xl font-bold">{config.title}</h1>
        {alreadySubmitted && (
          <div className="mt-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
            You already submitted a response. Submitting again replaces it (answers are encrypted, so they can't be
            pre-filled here).{" "}
            <button className="font-medium underline" onClick={() => setConfirmWithdraw(true)} disabled={busy}>
              Withdraw my response
            </button>
          </div>
        )}
      </Card>
      {showsTeammates && student.shareCode && (
        <Card className="bg-indigo-50">
          <h2 className="mb-1 font-semibold">Your share code</h2>
          <p className="text-sm text-slate-700">
            Give this code to classmates you'd like on your team, and ask them for theirs to enter in the teammates
            question below. It can't be used to log in, so it's safe to share — but keep your login code private.
          </p>
          <p className="mt-2 font-mono text-2xl font-bold tracking-widest">{student.shareCode}</p>
        </Card>
      )}
      <SurveyForm config={config} busy={busy} onSubmit={submit} />
      <ErrorText>{error}</ErrorText>
      <ConfirmDialog
        open={confirmWithdraw}
        title="Withdraw response?"
        confirmLabel="Withdraw response"
        busy={busy}
        onCancel={() => setConfirmWithdraw(false)}
        onConfirm={withdraw}
      >
        <p>Your encrypted answers will be deleted. You can submit again while the survey remains open.</p>
      </ConfirmDialog>
    </>
  );
}
