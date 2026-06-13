import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSession } from "../sessions/SessionContext";
import { getAllocationDoc, saveAllocation } from "../../lib/db";
import { eciesDecrypt, eciesEncrypt, unlockWithPassphrase, unlockWithRecoveryKey } from "../../lib/crypto";
import { hashCode } from "../../lib/codes";
import { downloadFile, toCsv } from "../../lib/util";
import { evaluateAssignment } from "../../solver/evaluate";
import type { SolveResult, SolverInput, SolverStudent, SolverTeam, WorkerResponse } from "../../solver/types";
import type { Allocation, SurveyAnswers } from "../../types";
import { Button, Card, ErrorText, Field, Input, NumberInput, Spinner } from "../../components/ui";
import { TeamBoard } from "./TeamBoard";

type Phase =
  | { name: "locked" }
  | { name: "decrypting" }
  | { name: "ready" }
  | { name: "solving"; message: string };

export function AllocationTab() {
  const { sid, session, publicConfig, projects, students } = useSession();
  const [phase, setPhase] = useState<Phase>({ name: "locked" });
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const privateKeyRef = useRef<CryptoKey | null>(null);
  const [solverStudents, setSolverStudents] = useState<SolverStudent[] | null>(null);
  const [assignment, setAssignment] = useState<Record<string, string[]> | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const [timeLimit, setTimeLimit] = useState(60);

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

  useEffect(() => () => workerRef.current?.terminate(), []);

  // ---------- unlock & decrypt ----------

  async function unlocked(privateKey: CryptoKey) {
    privateKeyRef.current = privateKey;
    setPhase({ name: "decrypting" });
    setError("");
    try {
      const teammatesQ = publicConfig.questions.find((q) => q.kind === "teammates");
      const decrypted: SolverStudent[] = [];
      for (const s of students) {
        let answers: SurveyAnswers = {};
        if (s.response) {
          answers = JSON.parse(await eciesDecrypt(privateKey, s.response)) as SurveyAnswers;
          // Convert teammate login codes to student hashes so the solver can
          // match them without ever seeing plaintext codes elsewhere.
          if (teammatesQ && Array.isArray(answers[teammatesQ.id])) {
            answers[teammatesQ.id] = await Promise.all(
              (answers[teammatesQ.id] as string[]).map((code) => hashCode(code)),
            );
          }
        }
        decrypted.push({ hash: s.hash, codeIndex: s.codeIndex, answers, submitted: !!s.submittedAt });
      }
      setSolverStudents(decrypted);

      // Load a previously saved allocation if there is one.
      const saved = await getAllocationDoc(sid);
      if (saved) {
        const alloc = JSON.parse(await eciesDecrypt(privateKey, saved.payload)) as Allocation;
        setAssignment(alloc.teams);
        setInfo("Loaded the previously saved allocation.");
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
    setInfo("Allocation saved (encrypted).");
  }

  function exportCsv() {
    if (!assignment || !solverStudents) return;
    const byHash = new Map(solverStudents.map((s) => [s.hash, s]));
    const rows: (string | number)[][] = [["team", "studentIndex"]];
    for (const t of teams) {
      for (const h of assignment[t.id] ?? []) {
        const s = byHash.get(h);
        if (s) rows.push([t.name, s.codeIndex]);
      }
    }
    downloadFile(`${sid}-teams.csv`, toCsv(rows), "text/csv");
  }

  // ---------- render ----------

  if (phase.name === "locked") {
    return <UnlockPanel wrapped={session.wrappedKeys} error={error} onUnlocked={unlocked} />;
  }
  if (phase.name === "decrypting") {
    return <Spinner label="Decrypting responses in your browser…" />;
  }

  const submittedCount = solverStudents?.filter((s) => s.submitted).length ?? 0;

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
            <Button onClick={runSolver} disabled={teams.length === 0}>
              {assignment ? "Re-run optimizer" : "Run optimizer"}
            </Button>
          )}
          <Button variant="secondary" onClick={save} disabled={!assignment}>
            Save (encrypted)
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={!assignment}>
            Export CSV
          </Button>
        </div>
        {phase.name === "solving" && <Spinner label={phase.message} />}
        <ErrorText>{error}</ErrorText>
        {info && <p className="mt-2 text-sm text-green-700">{info}</p>}
        {teams.length === 0 && (
          <p className="mt-2 text-sm text-amber-700">Define projects first (or mark the session as generic).</p>
        )}
      </Card>

      {assignment && solverInput && evaluation && (
        <TeamBoard
          input={solverInput}
          assignment={assignment}
          evaluation={evaluation}
          onChange={setAssignment}
        />
      )}
    </div>
  );
}

function UnlockPanel({
  wrapped,
  error,
  onUnlocked,
}: {
  wrapped: import("../../types").WrappedKeys;
  error: string;
  onUnlocked: (key: CryptoKey) => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [recovery, setRecovery] = useState("");
  const [localError, setLocalError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLocalError("");
    setBusy(true);
    try {
      const key = passphrase
        ? await unlockWithPassphrase(wrapped, passphrase)
        : await unlockWithRecoveryKey(wrapped, recovery);
      onUnlocked(key);
    } catch {
      setLocalError("Could not unlock — wrong passphrase or recovery key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-lg">
      <h2 className="mb-2 font-semibold">Unlock student data</h2>
      <p className="mb-3 text-sm text-slate-600">
        Responses are encrypted; decryption happens only in this browser tab and nothing decrypted is ever uploaded.
        Enter your session passphrase (or paste the recovery key from your backup file).
      </p>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Session passphrase">
          <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
        </Field>
        <Field label="… or recovery key">
          <Input value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="Base64 recovery key" />
        </Field>
        <ErrorText>{localError || error}</ErrorText>
        <Button type="submit" disabled={busy || (!passphrase && !recovery)}>
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
    </Card>
  );
}
