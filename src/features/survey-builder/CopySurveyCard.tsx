import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useSession } from "../sessions/SessionContext";
import { getPublicConfig, saveQuestionsAndConstraints, watchSessions } from "../../lib/db";
import { planSurveyCopy, type CopyPlan } from "./copySurvey";
import type { Question, SessionSummary } from "../../types";
import { Button, Card, ConfirmDialog, ErrorText, Field, Select, Spinner } from "../../components/ui";

/**
 * Reuses last term's survey: copies the questions and the constraints that go
 * with them from another session the instructor owns.
 *
 * Everything is appended, never substituted, so a session that already has work
 * in it cannot lose any. The plan is shown in full before anything is written —
 * including what will not come across and why, since a constraint that quietly
 * failed to arrive is one the instructor would only discover at allocation time.
 */
export function CopySurveyCard() {
  const { user } = useAuth();
  const { sid, session, publicConfig } = useSession();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [sourceQuestions, setSourceQuestions] = useState<Question[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    if (!user) return;
    return watchSessions(user.uid, setSessions);
  }, [user]);

  const others = useMemo(() => (sessions ?? []).filter((s) => s.id !== sid), [sessions, sid]);
  const source = others.find((s) => s.id === sourceId);

  // The questions live in the other session's public config, so they are fetched
  // only once one is picked; its constraints are already on the session row.
  useEffect(() => {
    setSourceQuestions(null);
    setError("");
    setDone("");
    if (!sourceId) return;
    let cancelled = false;
    setLoading(true);
    getPublicConfig(sourceId)
      .then((cfg) => {
        if (cancelled) return;
        if (!cfg) setError("That session's survey could not be read.");
        else setSourceQuestions(cfg.questions);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  const plan: CopyPlan | null = useMemo(() => {
    if (!source || !sourceQuestions) return null;
    return planSurveyCopy(
      { questions: sourceQuestions, constraints: source.constraints ?? [] },
      { questions: publicConfig.questions, constraints: session.constraints },
    );
  }, [source, sourceQuestions, publicConfig.questions, session.constraints]);

  async function apply() {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      await saveQuestionsAndConstraints(
        sid,
        [...publicConfig.questions, ...plan.questions],
        [...session.constraints, ...plan.constraints],
      );
      setDone(
        `Copied ${count(plan.questions.length, "question")} and ${count(plan.constraints.length, "constraint")}` +
          ` from "${source?.title ?? ""}".`,
      );
      setConfirming(false);
      setSourceId("");
    } catch (e) {
      setError(`Could not copy: ${e instanceof Error ? e.message : String(e)}`);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  // Nothing to offer until the instructor has a second session to copy from.
  if (sessions === null || others.length === 0) return null;

  const nothingToCopy = plan !== null && plan.questions.length === 0 && plan.constraints.length === 0;

  return (
    <Card className="border-slate-200 bg-slate-50">
      <h3 className="text-sm font-semibold">Reuse another session's survey</h3>
      <p className="mt-1 text-sm text-slate-600">
        Copies the questions and the constraints that go with them from one of your other sessions. Nothing here is
        replaced — everything is added to what this session already has.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Copy from">
          <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="w-full">
            <option value="">— select a session —</option>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          type="button"
          disabled={!plan || nothingToCopy || loading}
          onClick={() => setConfirming(true)}
          className="mb-1"
        >
          Copy
        </Button>
      </div>

      {loading && <Spinner label="Reading that session's survey…" />}
      <ErrorText>{error}</ErrorText>
      {done && <p className="mt-2 text-sm font-medium text-emerald-700">{done}</p>}

      {plan && !loading && (
        <div className="mt-3 space-y-2 text-sm">
          {nothingToCopy ? (
            <p className="text-slate-600">
              Nothing from that session can be copied here.{" "}
              {plan.skipped.length > 0 && "See the reasons below."}
            </p>
          ) : (
            <p className="text-slate-700">
              Will add <strong>{count(plan.questions.length, "question")}</strong> and{" "}
              <strong>{count(plan.constraints.length, "constraint")}</strong>.
            </p>
          )}
          {plan.skipped.length > 0 && <SkipList plan={plan} />}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title="Copy survey?"
        tone="primary"
        confirmLabel={busy ? "Copying…" : "Copy"}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={apply}
      >
        <p>
          Add {count(plan?.questions.length ?? 0, "question")} and{" "}
          {count(plan?.constraints.length ?? 0, "constraint")} from <strong>{source?.title}</strong> to this session?
        </p>
        {publicConfig.questions.length > 0 && (
          <p className="mt-2">
            This session already has {count(publicConfig.questions.length, "question")}. The copied ones are added
            after them; nothing is removed or overwritten.
          </p>
        )}
      </ConfirmDialog>
    </Card>
  );
}

function SkipList({ plan }: { plan: CopyPlan }) {
  return (
    <details className="rounded-md border border-slate-200 bg-white p-2">
      <summary className="cursor-pointer text-slate-700">
        {count(plan.skipped.length, "item")} will not be copied
      </summary>
      <ul className="mt-2 space-y-1 text-slate-600">
        {plan.skipped.map((s, i) => (
          <li key={i}>
            <span className="font-medium">{s.label}</span> — {s.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
