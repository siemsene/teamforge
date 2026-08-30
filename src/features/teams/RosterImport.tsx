import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../sessions/SessionContext";
import {
  getAllocationDoc,
  getTeamDirectoryDoc,
  provisionRoster,
  saveTeamDirectory,
  saveTeamMgmt,
} from "../../lib/db";
import { eciesDecrypt } from "../../lib/crypto";
import { defaultTeamMgmtConfig, publicTeamMgmt } from "./contractTemplate";
import { groupByTeam, parseRosterCsv } from "./rosterCsv";
import {
  hashRows,
  joinAllocationTeams,
  membershipFromAllocation,
  teamLabels,
  type Membership,
} from "./allocationTeams";
import { buildProvisioning, resolveRoster, type ResolvedTeam } from "./provision";
import { Button, Card, ConfirmDialog, ErrorText, Spinner } from "../../components/ui";
import { UnlockPanel } from "../sessions/UnlockPanel";
import type { Allocation, TeamDirectory, TeamMgmtConfig } from "../../types";

type Stage =
  | { name: "idle" }
  | {
      name: "preview";
      teams: ResolvedTeam[];
      problems: string[];
      previewNames: Map<number, string>;
      fromAllocation: number;
      fromFile: number;
    }
  | { name: "provisioning"; done: number; total: number }
  | { name: "done" };

/** Whether the saved allocation is available to supply team assignments. */
type AllocationState =
  | { name: "loading" }
  | { name: "none" }
  | { name: "locked" }
  | { name: "ready"; membership: Membership; count: number };

/**
 * Upload path: the login-codes CSV, exactly as downloaded.
 *
 * The file is needed for one reason only — login codes are shown once and never
 * stored, and a member key must be derived from each student's own code. Team
 * assignments are *not* re-entered: they come from the allocation already saved
 * for this session, joined by code hash. A `team` column in the file still wins
 * where present.
 *
 * Everything below runs in the instructor's browser. Only team membership is
 * uploaded. A `name` column is tolerated and shown in the preview so the
 * instructor can confirm they picked the right file, but it never leaves this
 * component — students choose their own display names.
 */
export function RosterImport({
  existingConfig,
  onDone,
}: {
  existingConfig?: TeamMgmtConfig;
  /** Called after a successful (re-)provision, so the caller can close the panel. */
  onDone?: () => void;
}) {
  const { sid, session, projects, students, sessionKey, setSessionKey } = useSession();
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [allocation, setAllocation] = useState<AllocationState>({ name: "loading" });
  const [error, setError] = useState("");
  const [showUnlock, setShowUnlock] = useState(false);
  const [confirmPartial, setConfirmPartial] = useState<ResolvedTeam[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const labels = useMemo(() => teamLabels(session, projects), [session, projects]);

  // A session that has been provisioned before carries contracts and chosen
  // display names in its team docs. Reaching those needs the previous directory,
  // which is encrypted — so re-provisioning locked would mint fresh tokens and
  // orphan the lot. Require the passphrase rather than quietly destroying it.
  const reprovisioning = existingConfig?.rosterUploadedAt != null;
  const needsUnlock = reprovisioning && !sessionKey;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const doc = await getAllocationDoc(sid);
        if (cancelled) return;
        if (!doc) return setAllocation({ name: "none" });
        if (!sessionKey) return setAllocation({ name: "locked" });
        const alloc = JSON.parse(await eciesDecrypt(sessionKey, doc.payload)) as Allocation;
        if (cancelled) return;
        const membership = membershipFromAllocation(alloc, labels);
        setAllocation({ name: "ready", membership, count: membership.byHash.size });
      } catch (e) {
        if (!cancelled) {
          setAllocation({ name: "none" });
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sid, sessionKey, labels]);

  async function onFile(file: File) {
    setError("");
    try {
      const text = await file.text();
      const parsed = parseRosterCsv(text);
      if (parsed.rows.length === 0) {
        setError(parsed.problems.join(" ") || "No rows found in the file.");
        return;
      }

      const membership: Membership =
        allocation.name === "ready" ? allocation.membership : { byHash: new Map(), problems: [] };
      const hashed = await hashRows(parsed.rows, students);
      const joined = joinAllocationTeams(hashed, membership);

      const rows = joined.rows.filter((r) => r.team);
      if (rows.length === 0) {
        setError(
          allocation.name === "ready"
            ? "None of these students appear in the saved allocation. Check you uploaded the right file."
            : 'No teams available: this session has no saved allocation, so the file needs a "team" column.',
        );
        return;
      }

      const codesByIndex = new Map(
        rows.filter((r) => r.code && r.index != null).map((r) => [r.index!, r.code]),
      );
      const resolved = await resolveRoster(
        students.map((s) => ({ hash: s.hash, codeIndex: s.codeIndex })),
        groupByTeam(rows),
        codesByIndex,
      );
      setStage({
        name: "preview",
        teams: resolved.teams,
        previewNames: resolved.previewNames,
        problems: [...parsed.problems, ...joined.problems, ...resolved.problems],
        fromAllocation: joined.fromAllocation,
        fromFile: joined.fromFile,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function provision(teams: ResolvedTeam[]) {
    setError("");
    setStage({ name: "provisioning", done: 0, total: teams.reduce((n, t) => n + t.members.length, 0) });
    try {
      // On a re-upload, hand the previous directory in so teams that already
      // exist keep their token — and therefore their doc, their contract and
      // everyone's chosen display names. Without it, provisioning again would
      // quietly throw all of that away.
      let previous: TeamDirectory | null = null;
      if (sessionKey) {
        const dirDoc = await getTeamDirectoryDoc(sid);
        if (dirDoc) previous = JSON.parse(await eciesDecrypt(sessionKey, dirDoc.payload)) as TeamDirectory;
      } else if (reprovisioning) {
        throw new Error(
          "Unlock this session first — without the passphrase the existing teams cannot be matched up, and their contracts and display names would be lost.",
        );
      }
      const built = await buildProvisioning(
        sid,
        session.wrappedKeys.publicKeyJwk,
        teams,
        (done, total) => setStage({ name: "provisioning", done, total }),
        previous,
      );
      await provisionRoster(sid, built.studentPatches, built.teamDocs, built.staleTokenHashes);
      await saveTeamDirectory(sid, built.directoryPayload);
      const config: TeamMgmtConfig = { ...(existingConfig ?? defaultTeamMgmtConfig()), rosterUploadedAt: Date.now() };
      await saveTeamMgmt(sid, config, publicTeamMgmt(config));
      setStage({ name: "done" });
      onDone?.();
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
    const missing = students.length - teamedCount;
    return (
      <Card>
        <h3 className="mb-2 font-semibold">Review the roster</h3>
        <p className="mb-3 text-sm text-slate-600">
          {stage.teams.length} teams, {teamedCount} of {students.length} students matched.{" "}
          {stage.fromAllocation > 0 && (
            <>
              {stage.fromAllocation} team assignment{stage.fromAllocation === 1 ? "" : "s"} came from your saved
              allocation
              {stage.fromFile > 0 && <>, {stage.fromFile} from a team column in your file</>}.{" "}
            </>
          )}
          {stage.fromAllocation === 0 && stage.fromFile > 0 && (
            <>All team assignments came from your file. </>
          )}
          Only team membership is uploaded — any names in your file stay in this browser, and each student chooses
          the display name their team and you will see.
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
                t.members.map((m, i) => (
                  <tr key={m.codeHash} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">
                      {i === 0 ? (
                        <span>
                          {t.label}{" "}
                          <span className="text-xs text-slate-400">({t.members.length})</span>
                        </span>
                      ) : (
                        <span className="text-slate-300">·</span>
                      )}
                    </td>
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
          <Button
            onClick={() =>
              // A file that covers only part of the class deletes every team it
              // does not mention, contracts and display names included. That was
              // always true, but adding students now hands the instructor a
              // second, smaller CSV — so picking the wrong one is suddenly easy.
              missing > 0 ? setConfirmPartial(stage.teams) : provision(stage.teams)
            }
            disabled={stage.teams.length === 0}
          >
            Provision {stage.teams.length} teams
          </Button>
          <Button variant="secondary" onClick={() => setStage({ name: "idle" })}>
            Choose a different file
          </Button>
        </div>
        <ConfirmDialog
          open={confirmPartial != null}
          title={`This file leaves out ${missing} student${missing === 1 ? "" : "s"}`}
          confirmLabel="Provision anyway"
          onCancel={() => setConfirmPartial(null)}
          onConfirm={() => {
            const teams = confirmPartial;
            setConfirmPartial(null);
            if (teams) void provision(teams);
          }}
        >
          <p>
            This session has {students.length} students, and this file accounts for {teamedCount}. Any team left
            with no members here is deleted — along with its contract and everyone&rsquo;s chosen display names.
          </p>
          <p>
            If you just added students, upload the <strong>master codes CSV with the new rows appended</strong>,
            not the file of new codes on its own.
          </p>
        </ConfirmDialog>
      </Card>
    );
  }

  if (needsUnlock) {
    return (
      <UnlockPanel
        wrapped={session.wrappedKeys}
        title="Unlock to change the teams"
        intro="These teams already have contracts and student-chosen display names, held in documents that only the encrypted team directory can point at. Enter your passphrase (or recovery key) so the new roster can be matched against the old one and that work kept."
        onUnlocked={setSessionKey}
      />
    );
  }

  if (showUnlock && allocation.name === "locked") {
    return (
      <UnlockPanel
        wrapped={session.wrappedKeys}
        title="Unlock to use your saved allocation"
        intro="The allocation is encrypted. Enter your session passphrase (or recovery key) to read the teams from it, so you don't have to enter them by hand."
        onUnlocked={(key) => {
          setSessionKey(key);
          setShowUnlock(false);
        }}
      />
    );
  }

  return (
    <Card>
      <h3 className="mb-2 font-semibold">
        {reprovisioning ? "Re-upload your login-codes CSV" : "Upload your login-codes CSV"}
      </h3>

      {reprovisioning && (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          This session already has teams. A team whose label is unchanged keeps its contract and its members&rsquo;
          chosen display names; a team that no longer appears is deleted along with both. Students who move team see
          the new one on their next login.
        </p>
      )}

      {allocation.name === "ready" && (
        <p className="mb-3 text-sm text-slate-600">
          Upload the <code className="rounded bg-slate-100 px-1 text-xs">student-codes.csv</code> you downloaded when
          you created this session — <strong>exactly as it is</strong>, no extra columns. Teams come from the
          allocation you already saved ({allocation.count} students). The file is needed only because login codes are
          never stored: each student&rsquo;s team is sealed under a key derived from their own code, so that code has
          to come from you. It stays in your browser.
        </p>
      )}

      {allocation.name === "locked" && (
        <p className="mb-3 text-sm text-slate-600">
          This session has a saved allocation, so you don&rsquo;t need to enter teams by hand — unlock with your
          passphrase and TeamForge will read them from it. You can also skip this and upload a file with its own{" "}
          <code className="rounded bg-slate-100 px-1 text-xs">team</code> column.
        </p>
      )}

      {allocation.name === "none" && (
        <p className="mb-3 text-sm text-slate-600">
          No saved allocation was found for this session, so your file needs a{" "}
          <code className="rounded bg-slate-100 px-1 text-xs">team</code> column (any label, e.g. &ldquo;Team 1&rdquo;
          or a project name). Identify each student by their login{" "}
          <code className="rounded bg-slate-100 px-1 text-xs">code</code> or their{" "}
          <code className="rounded bg-slate-100 px-1 text-xs">index</code>. The file stays in your browser.
        </p>
      )}

      {allocation.name === "loading" && <Spinner label="Checking for a saved allocation…" />}

      {allocation.name === "ready" && (
        <p className="mb-3 text-xs text-slate-500">
          Moved someone since you allocated? Add a{" "}
          <code className="rounded bg-slate-100 px-1 text-xs">team</code> column and it will override the saved
          allocation for the rows that have one.
        </p>
      )}

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
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => fileRef.current?.click()} disabled={allocation.name === "loading"}>
          Choose CSV file
        </Button>
        {allocation.name === "locked" && (
          <Button variant="secondary" onClick={() => setShowUnlock(true)}>
            Unlock to use the saved allocation
          </Button>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
