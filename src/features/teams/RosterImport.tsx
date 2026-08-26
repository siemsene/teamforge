import { useRef, useState } from "react";
import { useSession } from "../sessions/SessionContext";
import { provisionRoster, saveTeamDirectory, saveTeamMgmt } from "../../lib/db";
import { defaultTeamMgmtConfig, publicTeamMgmt } from "./contractTemplate";
import { groupByTeam, parseRosterCsv, type RosterRow } from "./rosterCsv";
import { buildProvisioning, resolveRoster, type ResolvedTeam } from "./provision";
import { Button, Card, ErrorText, Spinner } from "../../components/ui";
import type { TeamMgmtConfig } from "../../types";

type Stage =
  | { name: "idle" }
  | {
      name: "preview";
      rows: RosterRow[];
      teams: ResolvedTeam[];
      problems: string[];
      previewNames: Map<number, string>;
    }
  | { name: "provisioning"; done: number; total: number }
  | { name: "done" };

/**
 * Upload path: the completed login-codes CSV with a `team` column added.
 * Everything below runs in the instructor's browser.
 *
 * Only team membership is uploaded. A `name` column is tolerated and shown in
 * the preview below so the instructor can confirm they picked the right file,
 * but it never leaves this component — students choose their own display names.
 */
export function RosterImport({ existingConfig }: { existingConfig?: TeamMgmtConfig }) {
  const { sid, session, students } = useSession();
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setError("");
    try {
      const text = await file.text();
      const { rows, problems: parseProblems } = parseRosterCsv(text);
      if (rows.length === 0) {
        setError(parseProblems.join(" ") || "No rows found in the file.");
        return;
      }
      const groups = groupByTeam(rows);
      const codesByIndex = new Map(rows.filter((r) => r.code && r.index != null).map((r) => [r.index!, r.code]));
      const { teams, problems: resolveProblems, previewNames } = await resolveRoster(
        students.map((s) => ({ hash: s.hash, codeIndex: s.codeIndex })),
        groups,
        codesByIndex,
      );
      setStage({ name: "preview", rows, teams, problems: [...parseProblems, ...resolveProblems], previewNames });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function provision(teams: ResolvedTeam[]) {
    setError("");
    setStage({ name: "provisioning", done: 0, total: teams.reduce((n, t) => n + t.members.length, 0) });
    try {
      const built = await buildProvisioning(sid, session.wrappedKeys.publicKeyJwk, teams, (done, total) =>
        setStage({ name: "provisioning", done, total }),
      );
      await provisionRoster(sid, built.studentPatches, built.teamDocs);
      await saveTeamDirectory(sid, built.directoryPayload);
      const config: TeamMgmtConfig = { ...(existingConfig ?? defaultTeamMgmtConfig()), rosterUploadedAt: Date.now() };
      await saveTeamMgmt(sid, config, publicTeamMgmt(config));
      setStage({ name: "done" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage({ name: "idle" });
    }
  }

  if (stage.name === "provisioning") {
    return (
      <Card>
        <Spinner label={`Encrypting rosters in your browser… ${stage.done}/${stage.total}`} />
        <p className="mt-2 text-xs text-slate-500">
          One key is derived per student — this is deliberately slow (a few seconds for a small class).
        </p>
      </Card>
    );
  }

  if (stage.name === "done") {
    return (
      <Card>
        <p className="text-sm text-emerald-700">
          Teams provisioned. Students can now log in with their codes to see their team and contract.
        </p>
      </Card>
    );
  }

  if (stage.name === "preview") {
    const teamedCount = stage.teams.reduce((n, t) => n + t.members.length, 0);
    const hasBlocking = stage.teams.length === 0;
    return (
      <Card>
        <h3 className="mb-2 font-semibold">Review the roster</h3>
        <p className="mb-3 text-sm text-slate-600">
          {stage.teams.length} teams, {teamedCount} of {students.length} students matched. Only team membership is
          uploaded — any names in your file stay in this browser, and each student chooses the display name their
          team and you will see.
        </p>
        {stage.problems.length > 0 && (
          <div className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Check these before provisioning:</p>
            <ul className="mt-1 list-disc pl-5">
              {stage.problems.slice(0, 12).map((p, i) => (
                <li key={i}>{p}</li>
              ))}
              {stage.problems.length > 12 && <li>…and {stage.problems.length - 12} more.</li>}
            </ul>
          </div>
        )}
        <div className="mb-3 max-h-72 overflow-auto rounded-md border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-1.5">Team</th>
                <th className="px-3 py-1.5">#</th>
                <th className="px-3 py-1.5">Name in your file (not uploaded)</th>
              </tr>
            </thead>
            <tbody>
              {stage.teams.flatMap((t) =>
                t.members.map((m) => (
                  <tr key={m.codeHash} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">{t.label}</td>
                    <td className="px-3 py-1.5 text-slate-500">#{m.codeIndex}</td>
                    <td className="px-3 py-1.5 text-slate-500">
                      {stage.previewNames.get(m.codeIndex) ?? "—"}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button onClick={() => provision(stage.teams)} disabled={hasBlocking}>
            Provision {stage.teams.length} teams
          </Button>
          <Button variant="secondary" onClick={() => setStage({ name: "idle" })}>
            Choose a different file
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h3 className="mb-2 font-semibold">Upload the final team roster</h3>
      <p className="mb-3 text-sm text-slate-600">
        Take the login-codes CSV you downloaded when creating this session and add two columns:{" "}
        <code className="rounded bg-slate-100 px-1 text-xs">name</code> and{" "}
        <code className="rounded bg-slate-100 px-1 text-xs">team</code> (any label, e.g. "Team 1" or a project name).
        You can identify each student by their login <code className="rounded bg-slate-100 px-1 text-xs">code</code> or
        their <code className="rounded bg-slate-100 px-1 text-xs">index</code>. This file stays in your browser.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />
      <Button onClick={() => fileRef.current?.click()}>Choose CSV file</Button>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
