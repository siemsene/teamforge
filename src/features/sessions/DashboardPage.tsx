import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { createSession, watchSessions } from "../../lib/db";
import { generateSessionKeys } from "../../lib/crypto";
import { generateCodes, hashCode } from "../../lib/codes";
import { downloadFile, randomId, surveyUrl, toCsv } from "../../lib/util";
import { DEFAULT_PRIVACY_NOTE } from "./privacyNote";
import type { PublicConfig, SessionDoc, SessionSummary } from "../../types";
import { Badge, Button, Card, ErrorText, Field, Input, Spinner } from "../../components/ui";

const STATUS_TONE = { draft: "gray", open: "green", closed: "amber" } as const;

export function DashboardPage() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!user) return;
    return watchSessions(user.uid, setSessions);
  }, [user]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My sessions</h1>
        <Button onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "New session"}</Button>
      </div>

      {creating && <NewSessionForm onDone={() => setCreating(false)} />}

      {!sessions ? (
        <Spinner />
      ) : sessions.length === 0 && !creating ? (
        <Card>
          <p className="text-sm text-slate-600">No sessions yet. Create one to get started.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <Link key={s.id} to={`/session/${s.id}`} className="block">
              <Card className="transition-shadow hover:shadow-md">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold">{s.title}</span>
                    <span className="ml-3 text-sm text-slate-500">
                      {s.numStudents} students · ideal team size {s.idealTeamSize} ·{" "}
                      {s.genericProjects ? `${s.numTeams} generic teams` : "named projects"}
                    </span>
                  </div>
                  <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NewSessionForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [numStudents, setNumStudents] = useState(30);
  const [idealTeamSize, setIdealTeamSize] = useState(5);
  const [minTeamSize, setMinTeamSize] = useState(4);
  const [maxTeamSize, setMaxTeamSize] = useState(6);
  const [genericProjects, setGenericProjects] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [passphrase2, setPassphrase2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const defaultTeams = useMemo(
    () => Math.max(1, Math.ceil(numStudents / Math.max(1, idealTeamSize))),
    [numStudents, idealTeamSize],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!user) return;
    if (passphrase.length < 10) return setError("Passphrase must be at least 10 characters.");
    if (passphrase !== passphrase2) return setError("Passphrases do not match.");
    if (minTeamSize > idealTeamSize || idealTeamSize > maxTeamSize)
      return setError("Team sizes must satisfy min ≤ ideal ≤ max.");
    if (numStudents < 2 || numStudents > 1000) return setError("Number of students must be between 2 and 1000.");

    setBusy(true);
    try {
      const sid = randomId();
      const { wrappedKeys, recoveryKeyB64 } = await generateSessionKeys(passphrase);
      const codes = generateCodes(numStudents);
      const hashes = await Promise.all(codes.map(hashCode));

      const session: SessionDoc = {
        ownerUid: user.uid,
        title: title.trim(),
        status: "draft",
        numStudents,
        idealTeamSize,
        minTeamSize,
        maxTeamSize,
        genericProjects,
        numTeams: defaultTeams,
        constraints: [],
        wrappedKeys,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const publicConfig: PublicConfig = {
        title: title.trim(),
        status: "draft",
        publicKeyJwk: wrappedKeys.publicKeyJwk,
        questions: [],
        projects: [],
        genericProjects,
        privacyNote: DEFAULT_PRIVACY_NOTE,
      };

      await createSession(sid, session, publicConfig, hashes);

      // One-time downloads: login codes + recovery key. Codes are never stored
      // server-side (only their hashes), so this is the only copy.
      const link = surveyUrl(sid);
      downloadFile(
        `${sid}-student-codes.csv`,
        toCsv([
          ["studentIndex", "loginCode", "surveyLink", "yourStudentName", "yourStudentEmail"],
          ...codes.map((c, i) => [i + 1, c, link, "", ""]),
        ]),
        "text/csv",
      );
      downloadFile(
        `${sid}-recovery-key.txt`,
        `TeamForge recovery key for session "${title.trim()}" (${sid})\n` +
          `Keep this file safe. It unlocks student data if you forget your passphrase.\n\n${recoveryKeyB64}\n`,
      );
      window.alert(
        "Two files were downloaded:\n\n" +
          "1. Student login codes (CSV) — assign a code to each student in the two empty columns and keep that list private. Codes are NOT stored on the server and cannot be re-downloaded.\n\n" +
          "2. Recovery key — store it somewhere safe (not with the codes). It is the only way to unlock survey data if you forget your passphrase.",
      );
      onDone();
      navigate(`/session/${sid}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 font-semibold">New session</h2>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Session title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="MGMT 4500 Spring 2027" required />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Students">
            <Input type="number" min={2} max={1000} value={numStudents} onChange={(e) => setNumStudents(+e.target.value)} />
          </Field>
          <Field label="Ideal team size">
            <Input type="number" min={1} value={idealTeamSize} onChange={(e) => setIdealTeamSize(+e.target.value)} />
          </Field>
          <Field label="Min team size">
            <Input type="number" min={1} value={minTeamSize} onChange={(e) => setMinTeamSize(+e.target.value)} />
          </Field>
          <Field label="Max team size">
            <Input type="number" min={1} value={maxTeamSize} onChange={(e) => setMaxTeamSize(+e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={genericProjects} onChange={(e) => setGenericProjects(e.target.checked)} />
          Generic projects — just split students into {defaultTeams} teams, no named projects
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Encryption passphrase" hint="Encrypts all student data. Min 10 characters.">
            <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} required />
          </Field>
          <Field label="Repeat passphrase">
            <Input type="password" value={passphrase2} onChange={(e) => setPassphrase2(e.target.value)} required />
          </Field>
        </div>
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
          Student answers are encrypted with a key only you control. If you lose both the passphrase and the recovery
          key file (downloaded next), the data is permanently unreadable — by design, nobody can recover it for you.
        </p>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy}>
          {busy ? "Generating keys and codes…" : "Create session"}
        </Button>
      </form>
    </Card>
  );
}
