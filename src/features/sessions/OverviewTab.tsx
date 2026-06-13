import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "./SessionContext";
import { deleteSessionCompletely, updatePublicConfig, updateSession } from "../../lib/db";
import { surveyUrl } from "../../lib/util";
import type { SessionStatus } from "../../types";
import { Button, Card, ErrorText, TextArea } from "../../components/ui";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function applyStatus(sid: string, status: SessionStatus) {
  await updateSession(sid, { status });
  await updatePublicConfig(sid, { status });
}

function defaultEmailTemplate(title: string, link: string): string {
  return `Subject: ${title} — team formation survey

Dear <STUDENT NAME>,

To help form project teams, please complete a short survey. Your responses are anonymous and encrypted — the platform never learns your name, and only I can read the answers (see the privacy notice on the survey page).

1. Open: ${link}
2. Enter your personal login code: <LOGIN CODE>

Please complete it by <DEADLINE>. Keep your login code private. If you want to team up with specific classmates, the survey shows you a short "share code" after you log in — exchange those with each other (not your login codes) and enter them in the preferred-teammates question.

Thank you!`;
}

export function OverviewTab() {
  const { sid, session, students, publicConfig } = useSession();
  const navigate = useNavigate();
  const [copied, setCopied] = useState("");
  const submitted = students.filter((s) => s.submittedAt).length;
  const link = surveyUrl(sid);

  const fallback = defaultEmailTemplate(session.title, link);
  const [template, setTemplate] = useState(session.emailTemplate ?? fallback);
  const [savedMsg, setSavedMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = template !== (session.emailTemplate ?? fallback);

  async function copy(text: string, which: string) {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(""), 1500);
  }

  async function changeStatus(status: SessionStatus) {
    setError("");
    try {
      await applyStatus(sid, status);
    } catch (e) {
      setError(`Could not change status: ${errMsg(e)}`);
    }
  }

  async function saveTemplate() {
    setBusy(true);
    setError("");
    try {
      await updateSession(sid, { emailTemplate: template });
      setSavedMsg("Email template saved.");
      setTimeout(() => setSavedMsg(""), 1500);
    } catch (e) {
      setError(`Could not save the email template: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSession() {
    if (
      !window.confirm(
        `Permanently delete the ENTIRE session "${session.title}" — students, projects, survey, constraints, allocation?\n\nThis cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await deleteSessionCompletely(sid);
      navigate("/dashboard");
    } catch (e) {
      setError(`Could not delete the session: ${errMsg(e)}`);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 font-semibold">Session status</h2>
        <p className="mb-3 text-sm text-slate-600">
          <strong>Draft:</strong> set up projects, survey and constraints — students cannot submit yet.{" "}
          <strong>Open:</strong> students can complete the survey. <strong>Closed:</strong> submissions locked; run
          the allocation.
        </p>
        <div className="flex gap-2">
          {(["draft", "open", "closed"] as const).map((s) => (
            <Button
              key={s}
              variant={session.status === s ? "primary" : "secondary"}
              onClick={() => changeStatus(s)}
            >
              {s}
            </Button>
          ))}
        </div>
        <ErrorText>{error}</ErrorText>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">At a glance</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-slate-500">Students</dt>
          <dd>{session.numStudents}</dd>
          <dt className="text-slate-500">Submitted</dt>
          <dd>
            {submitted} / {session.numStudents}
          </dd>
          <dt className="text-slate-500">Team size</dt>
          <dd>
            {session.minTeamSize}–{session.maxTeamSize} (ideal {session.idealTeamSize})
          </dd>
          <dt className="text-slate-500">Teams</dt>
          <dd>{session.genericProjects ? `${session.numTeams} generic` : "one per project"}</dd>
          <dt className="text-slate-500">Survey questions</dt>
          <dd>{publicConfig.questions.length}</dd>
          <dt className="text-slate-500">Constraints</dt>
          <dd>{session.constraints.length}</dd>
        </dl>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">Invite students</h2>
        <p className="mb-2 text-sm text-slate-600">
          Survey link:{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{link}</code>{" "}
          <Button variant="ghost" onClick={() => copy(link, "link")}>
            {copied === "link" ? "Copied!" : "Copy"}
          </Button>
        </p>
        <p className="mb-2 text-sm text-slate-600">
          Use the login-codes CSV you downloaded at creation to assign one code per student, then send each student
          the link and their code (mail merge works well). Edit the template below to match your course; placeholders
          like <code className="rounded bg-slate-100 px-1 text-xs">&lt;LOGIN CODE&gt;</code> are filled per student.
        </p>
        <TextArea rows={12} value={template} onChange={(e) => setTemplate(e.target.value)} className="font-mono text-xs" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button onClick={saveTemplate} disabled={busy || !dirty}>
            {busy ? "Saving…" : dirty ? "Save template" : "Saved"}
          </Button>
          <Button variant="secondary" onClick={() => copy(template, "template")}>
            {copied === "template" ? "Copied!" : "Copy email"}
          </Button>
          <Button variant="ghost" onClick={() => setTemplate(fallback)} disabled={template === fallback}>
            Reset to default
          </Button>
          {savedMsg && <span className="text-sm text-green-700">{savedMsg}</span>}
        </div>
      </Card>

      <Card className="border-red-200">
        <h2 className="mb-2 font-semibold text-red-700">Danger zone</h2>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-slate-600">
            Permanently delete this entire session and all its data. For finer-grained options (e.g. purging only
            student responses), see the <strong>Privacy &amp; data</strong> tab.
          </p>
          <Button variant="danger" disabled={busy} onClick={deleteSession}>
            Delete session
          </Button>
        </div>
      </Card>
    </div>
  );
}
