import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../sessions/SessionContext";
import { getAllocationDoc, saveAllocation } from "../../lib/db";
import { eciesDecrypt, eciesEncrypt } from "../../lib/crypto";
import { normalizeCode } from "../../lib/codes";
import { downloadFile, sessionFilename, toCsv } from "../../lib/util";
import { evaluateAssignment } from "../../solver/evaluate";
import type { SolveResult, SolverInput, SolverStudent, SolverTeam, WorkerResponse } from "../../solver/types";
import type { Allocation, SurveyAnswers } from "../../types";
import { Button, Card, ErrorText, Field, NumberInput, Spinner } from "../../components/ui";
import { TeamBoard } from "./TeamBoard";
import { getSessionReadiness } from "../sessions/readiness";
import { allocationDrift } from "../sessions/rosterStaleness";
import { UnlockPanel } from "../sessions/UnlockPanel";

/** Order-independent fingerprint of an assignment, for comparing against the
 * saved copy: reordering members within a team is not a change. */
function stableKey(a: Record<string, string[]>): string {
  return JSON.stringify(
    Object.entries(a)
      .map(([id, hashes]) => [id, [...hashes].sort()] as const)
      .sort(([x], [y]) => x.localeCompare(y)),
  );
}

type Phase =
  | { name: "locked" }
  | { name: "decrypting" }
  | { name: "ready" }
  | { name: "solving"; message: string };

interface ResponseProblem {
  codeIndex: number;
  message: string;
}

export function AllocationTab() {
  const { sid, session, publicConfig, projects, students, sessionKey, setSessionKey } = useSession();
  const [phase, setPhase] = useState<Phase>({ name: "locked" });
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const privateKeyRef = useRef<CryptoKey | null>(null);
  const [solverStudents, setSolverStudents] = useState<SolverStudent[] | null>(null);
  const [assignment, setAssignment] = useState<Record<string, string[]> | null>(null);
  // What is actually stored, so the board can say when it has drifted from it.
  // The Teams tab builds its roster from the *saved* allocation, so a drag left
  // unsaved would silently never reach a student.
  const [savedAssignment, setSavedAssignment] = useState<string | null>(null);
  const [responseProblems, setResponseProblems] = useState<ResponseProblem[]>([]);
  /** Teammate share codes that matched nobody in this session. */
  const [unmatchedCodes, setUnmatchedCodes] = useState<{ codeIndex: number; codes: string[] }[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const [timeLimit, setTimeLimit] = useState(60);
  const readiness = useMemo(() => getSessionReadiness(session, publicConfig, projects, students.length), [session, publicConfig, projects, students.length]);

  const teams: SolverTeam[] = useMemo(() => {
    if (session.genericProjects) {
      return Array.from({ length: session.numTeams }, (_, k) => ({
        id: `team-${k + 1}`,
        name: `Team ${k + 1}`,
        minSize: session.minTeamSize,
        maxSize: session.maxTeamSize,
        requirements: [],
      }));
    }
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      minSize: p.minSize ?? session.minTeamSize,
      maxSize: p.maxSize ?? session.maxTeamSize,
      requirements: p.requirements,
    }));
  }, [session, projects]);

  const solverInput: SolverInput | null = useMemo(() => {
    if (!solverStudents) return null;
    return {
      students: solverStudents,
      teams,
      idealTeamSize: session.idealTeamSize,
      constraints: session.constraints,
      questions: publicConfig.questions,
      timeLimitSeconds: timeLimit,
    };
  }, [solverStudents, teams, session, publicConfig, timeLimit]);

  const evaluation = useMemo(() => {
    if (!solverInput || !assignment) return null;
    return evaluateAssignment(solverInput, assignment);
  }, [solverInput, assignment]);

  const dirty = assignment != null && stableKey(assignment) !== savedAssignment;

  // Exact, not a timestamp: this tab holds both the live roster and the
  // decrypted assignment, so it can name who is adrift and in which direction.
  const drift = useMemo(
    () => (assignment ? allocationDrift(students, assignment) : null),
    [students, assignment],
  );

  // Reloads and tab closes are the browser's to warn about; in-app navigation is
  // handled by the banner on the board itself.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  // Students can be added or removed while this tab is open. Re-derive the
  // solver input when that happens (or when someone submits), but leave the
  // board alone — the instructor may be part-way through moving people.
  const rosterKey = students.map((s) => `${s.hash}:${s.submittedAt ?? 0}`).join("|");
  const lastRosterKey = useRef("");
  useEffect(() => {
    if (!privateKeyRef.current || !solverStudents) return;
    if (lastRosterKey.current === rosterKey) return;
    lastRosterKey.current = rosterKey;
    void decryptStudents(privateKeyRef.current).catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey]);

  // If another tab already unlocked this session, decrypt immediately.
  const decryptedRef = useRef(false);
  useEffect(() => {
    if (sessionKey && !decryptedRef.current) {
      decryptedRef.current = true;
      void unlocked(sessionKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  // ---------- unlock & decrypt ----------

  /**
   * Decrypt every student's response into solver input.
   *
   * Separate from `unlocked` because the roster is no longer fixed once the
   * session exists: a student added (or removed) after the instructor unlocked
   * must reach the solver, and re-running the whole unlock would reload the
   * saved allocation over whatever they were dragging.
   */
  async function decryptStudents(privateKey: CryptoKey) {
    const teammatesQ = publicConfig.questions.find((q) => q.kind === "teammates");
    // Students list classmates by their public share code; map those to the
    // classmate's student hash so the solver can pair them.
    const shareToHash = new Map(
      students.filter((s) => s.shareCode).map((s) => [normalizeCode(s.shareCode!), s.hash]),
    );
    const decrypted: SolverStudent[] = [];
    const problems: ResponseProblem[] = [];
    const unmatched: { codeIndex: number; codes: string[] }[] = [];
    for (const s of students) {
      let answers: SurveyAnswers = {};
      if (s.response) {
        try {
          answers = JSON.parse(await eciesDecrypt(privateKey, s.response)) as SurveyAnswers;
          if (teammatesQ && Array.isArray(answers[teammatesQ.id])) {
            const entered = answers[teammatesQ.id] as string[];
            const resolved = entered.map((code) => ({ code, hash: shareToHash.get(normalizeCode(code)) }));
            // A mistyped share code used to be dropped in silence: the student
            // believed their preference was recorded and the instructor never
            // learned it had gone. Neither can act on what nobody is told.
            const missed = resolved.filter((r) => !r.hash).map((r) => r.code);
            if (missed.length > 0) unmatched.push({ codeIndex: s.codeIndex, codes: missed });
            answers[teammatesQ.id] = resolved
              .map((r) => r.hash)
              .filter((h): h is string => Boolean(h));
          }
        } catch (err) {
          problems.push({
            codeIndex: s.codeIndex,
            message: err instanceof Error ? err.message : "Could not decrypt or parse this response.",
          });
        }
      }
      decrypted.push({ hash: s.hash, codeIndex: s.codeIndex, answers, submitted: !!s.submittedAt });
    }
    setSolverStudents(decrypted);
    setResponseProblems(problems);
    setUnmatchedCodes(unmatched);
  }

  async function unlocked(privateKey: CryptoKey) {
    privateKeyRef.current = privateKey;
    if (!sessionKey) setSessionKey(privateKey);
    setPhase({ name: "decrypting" });
    setError("");
    try {
      await decryptStudents(privateKey);

      // Load a previously saved allocation if there is one.
      const saved = await getAllocationDoc(sid);
      if (saved) {
        try {
          const alloc = JSON.parse(await eciesDecrypt(privateKey, saved.payload)) as Allocation;
          setAssignment(alloc.teams);
          setSavedAssignment(stableKey(alloc.teams));
          setInfo("Loaded the previously saved allocation.");
        } catch (err) {
          setInfo(
            `Student responses were unlocked, but the saved allocation could not be loaded: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      setPhase({ name: "ready" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase({ name: "locked" });
    }
  }

  // ---------- solve ----------

  function runSolver() {
    if (!solverInput) return;
    setError("");
    setInfo("");
    setPhase({ name: "solving", message: "Starting solver…" });
    const worker = new Worker(new URL("../../solver/worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "status") setPhase({ name: "solving", message: msg.message });
      if (msg.type === "error") {
        setError(msg.message);
        setPhase({ name: "ready" });
        worker.terminate();
      }
      if (msg.type === "done") {
        applySolution(msg.result);
        worker.terminate();
      }
    };
    worker.onerror = (e) => {
      setError(`Solver crashed: ${e.message}`);
      setPhase({ name: "ready" });
      worker.terminate();
    };
    worker.postMessage({ type: "solve", input: solverInput });
  }

  function applySolution(result: SolveResult) {
    setAssignment(result.teams);
    setInfo(
      result.status === "Optimal"
        ? "Solved to optimality."
        : "Time limit reached — this is the best allocation found so far.",
    );
    setPhase({ name: "ready" });
  }

  function cancelSolve() {
    workerRef.current?.terminate();
    setPhase({ name: "ready" });
    setInfo("Solve cancelled.");
  }

  // ---------- save / export ----------

  async function save() {
    if (!assignment || !evaluation) return;
    const alloc: Allocation = { teams: assignment, objective: evaluation.totalPenalty, solvedAt: Date.now() };
    const payload = await eciesEncrypt(session.wrappedKeys.publicKeyJwk, JSON.stringify(alloc));
    await saveAllocation(sid, payload);
    setSavedAssignment(stableKey(assignment));
    setInfo("Allocation saved (encrypted).");
  }

  function exportCsv() {
    if (!assignment || !solverStudents) return;
    const byHash = new Map(solverStudents.map((s) => [s.hash, s]));
    const nameById = new Map(teams.map((t) => [t.id, t.name]));
    const rows: (string | number)[][] = [["team", "studentIndex"]];
    const orphaned: string[] = [];
    // Walk the assignment, not the current team list. A project renamed or
    // deleted since the allocation was saved leaves its id unmatched, and
    // iterating the teams instead dropped those students from the file with
    // nothing said — the roster join reports exactly this case, so this does too.
    for (const [teamId, hashes] of Object.entries(assignment)) {
      const label = nameById.get(teamId);
      if (label == null && hashes.length > 0) orphaned.push(teamId);
      for (const h of hashes) {
        const s = byHash.get(h);
        if (s) rows.push([label ?? teamId, s.codeIndex]);
      }
    }
    downloadFile(sessionFilename(session.title, sid, "teams.csv"), toCsv(rows), "text/csv");
    setInfo(
      orphaned.length > 0
        ? `Exported ${rows.length - 1} students. ${orphaned.length} team${orphaned.length === 1 ? "" : "s"} in the saved allocation no longer match a project, so ${orphaned.length === 1 ? "its id was" : "their ids were"} used as the label: ${orphaned.join(", ")}. Re-run the optimizer if that is not what you want.`
        : `Exported ${rows.length - 1} students.`,
    );
  }

  // ---------- render ----------

  if (phase.name === "locked") {
    return <UnlockPanel wrapped={session.wrappedKeys} error={error} onUnlocked={unlocked} />;
  }
  if (phase.name === "decrypting") {
    return <Spinner label="Decrypting responses in your browser…" />;
  }

  const submittedCount = solverStudents?.filter((s) => s.submitted).length ?? 0;
  // The model has one binary per (student, team); very large instances may not
  // reach a proven optimum within the time limit.
  const numVars = students.length * teams.length;
  const largeProblem = numVars > 6000;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto text-sm text-slate-600">
            <p>
              {submittedCount} of {students.length} students submitted. Students without a response are still placed
              (they count for team size but have no attributes or preferences).
            </p>
          </div>
          <Field label="Solver time limit (s)">
            <NumberInput
              min={5}
              max={600}
              className="w-24"
              value={timeLimit}
              onValueChange={setTimeLimit}
            />
          </Field>
          {phase.name === "solving" ? (
            <Button variant="danger" onClick={cancelSolve}>
              Cancel
            </Button>
          ) : (
            <Button onClick={runSolver} disabled={teams.length === 0 || readiness.blockers.length > 0}>
              {assignment ? "Re-run optimizer" : "Run optimizer"}
            </Button>
          )}
          <Button variant={dirty ? "primary" : "secondary"} onClick={save} disabled={!assignment}>
            {dirty ? "Save changes (encrypted)" : "Save (encrypted)"}
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={!assignment}>
            Export CSV
          </Button>
        </div>
        {phase.name === "solving" && <Spinner label={phase.message} />}
        <ErrorText>{error}</ErrorText>
        {info && <p className="mt-2 text-sm text-green-700">{info}</p>}
        {drift && (drift.unassignedCodeIndexes.length > 0 || drift.ghostHashes.length > 0) && (
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">The roster has changed since this allocation was worked out.</p>
            {drift.unassignedCodeIndexes.length > 0 && (
              <p className="mt-1">
                {drift.unassignedCodeIndexes.length === 1 ? "Student" : "Students"}{" "}
                {drift.unassignedCodeIndexes.map((i) => `#${i}`).join(", ")}{" "}
                {drift.unassignedCodeIndexes.length === 1 ? "was" : "were"} added and{" "}
                {drift.unassignedCodeIndexes.length === 1 ? "is" : "are"} on no team yet.
              </p>
            )}
            {drift.ghostHashes.length > 0 && (
              <p className="mt-1">
                {drift.ghostHashes.length} student{drift.ghostHashes.length === 1 ? "" : "s"} placed by this
                allocation {drift.ghostHashes.length === 1 ? "has" : "have"} been removed from the session. Their
                {drift.ghostHashes.length === 1 ? " seat is" : " seats are"} still counted until you re-run.
              </p>
            )}
            <p className="mt-1">Re-run the optimizer (or move the rest by hand) and save before announcing teams.</p>
          </div>
        )}
        {responseProblems.length > 0 && (
          <div className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">
              {responseProblems.length} submitted response{responseProblems.length === 1 ? "" : "s"} could not be
              read.
            </p>
            <p className="mt-1">
              Those students are still placed for team-size purposes, but their survey answers and preferences are
              ignored until they resubmit.
            </p>
            <ul className="mt-2 list-disc pl-5">
              {responseProblems.map((p) => (
                <li key={p.codeIndex}>
                  #{p.codeIndex}: {p.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {unmatchedCodes.length > 0 && (
          <div className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">
              {unmatchedCodes.reduce((n, u) => n + u.codes.length, 0)} teammate share code
              {unmatchedCodes.reduce((n, u) => n + u.codes.length, 0) === 1 ? "" : "s"} did not match anyone in this
              session.
            </p>
            <p className="mt-1">
              Usually a typo, or a code from a different session. Those preferences are ignored — everything else in
              the response still counts.
            </p>
            <ul className="mt-2 list-disc pl-5">
              {unmatchedCodes.slice(0, 10).map((u) => (
                <li key={u.codeIndex}>
                  #{u.codeIndex} entered {u.codes.map((c) => `"${c}"`).join(", ")}
                </li>
              ))}
              {unmatchedCodes.length > 10 && <li>…and {unmatchedCodes.length - 10} more students.</li>}
            </ul>
          </div>
        )}
        {teams.length === 0 && (
          <p className="mt-2 text-sm text-amber-700">Define projects first (or mark the session as generic).</p>
        )}
        {readiness.blockers.length > 0 && (
          <p className="mt-2 text-sm text-amber-700">
            Fix setup readiness blockers before running the optimizer:{" "}
            {readiness.blockers.map((b) => b.label).join(", ")}.
          </p>
        )}
        {largeProblem && phase.name !== "solving" && (
          <p className="mt-2 text-sm text-amber-700">
            Large problem ({students.length} students × {teams.length} teams ≈ {numVars.toLocaleString()} variables).
            The optimizer may not reach a proven optimum within the time limit — raise the limit, accept a good-enough
            result, or use fewer teams.
          </p>
        )}
      </Card>

      {assignment && solverInput && evaluation && (
        <TeamBoard
          input={solverInput}
          assignment={assignment}
          evaluation={evaluation}
          dirty={dirty}
          onChange={setAssignment}
        />
      )}
    </div>
  );
}
