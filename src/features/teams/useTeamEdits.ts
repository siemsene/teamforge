import { useMemo, useState } from "react";
import { removeStudents } from "../../lib/db";
import { hashCode } from "../../lib/codes";
import { deriveMemberKeyRaw } from "../../lib/memberKey";
import { downloadFile } from "../../lib/util";
import type { SessionDoc, StudentDoc, TeamDirectory } from "../../types";
import { commitAddedStudents, mintStudents, type AddedCodes } from "../completion/addStudentsFlow";
import type { ResolvedTeam } from "./provision";
import { reprovisionTeams } from "./reprovision";
import {
  applyTeamEdit,
  teamsFromDirectory,
  unassignedStudents,
  type DirectoryTeams,
  type LiveStudent,
  type TeamEdit,
} from "./teamEdit";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The write side of editing provisioned teams by hand.
 *
 * Every operation ends in the same rebuild (`reprovisionTeams`), which is what
 * keeps them safe to retry: the directory is the source of truth, and
 * re-sealing from it is idempotent. What differs is the step before — a
 * student document to delete, a login code to mint, a key to derive — and the
 * order it has to happen in.
 */
export function useTeamEdits({
  sid,
  session,
  students,
  directory,
  setDirectory,
}: {
  sid: string;
  session: SessionDoc;
  students: (StudentDoc & { hash: string })[];
  directory: TeamDirectory | null;
  setDirectory: (d: TeamDirectory) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<AddedCodes | null>(null);

  const base: DirectoryTeams | null = useMemo(
    () => (directory ? teamsFromDirectory(directory, students) : null),
    [directory, students],
  );
  const unassigned: LiveStudent[] = useMemo(
    () => (directory ? unassignedStudents(directory, students) : []),
    [directory, students],
  );
  const canEdit = base != null && base.missingKey.length === 0 && !busy;

  async function reprovision(teams: ResolvedTeam[]) {
    setProgress({ done: 0, total: teams.reduce((n, t) => n + t.members.length, 0) });
    const next = await reprovisionTeams(sid, session, directory, teams, {
      onProgress: (done, total) => setProgress({ done, total }),
      students,
    });
    setDirectory(next);
  }

  /** Runs `fn`, owning busy/error state. Resolves to whether it succeeded. */
  async function guarded(fn: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errMsg(e));
      return false;
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  /** Move, delete an empty team, place a student whose key we hold, or sync. */
  function run(edit: TeamEdit): Promise<boolean> {
    return guarded(async () => {
      if (!base) throw new Error("The team directory is not loaded.");
      await reprovision(applyTeamEdit(base.teams, edit));
    });
  }

  /**
   * Drop a student from the session and take them off their team in one go.
   *
   * The document is deleted first. If the rebuild then fails, the roster has
   * changed after the teams were provisioned and the stale banner says so —
   * the recovery the Roster tab already relies on. The other order would leave a
   * student who still exists holding a roster blob that says nothing.
   */
  function removeFromSession(member: { codeHash: string; codeIndex: number }): Promise<boolean> {
    return guarded(async () => {
      if (!directory) throw new Error("The team directory is not loaded.");
      await removeStudents(sid, [{ hash: member.codeHash, codeIndex: member.codeIndex }]);
      // From an explicit list, not the live snapshot: the deletion may not have
      // reached it yet, and a batch that updates a deleted doc fails whole.
      const live = students.filter((s) => s.hash !== member.codeHash);
      const rebuilt = teamsFromDirectory(directory, live);
      if (rebuilt.missingKey.length > 0) throw new Error("Some students have no stored key; re-upload the codes CSV.");
      await reprovision(rebuilt.teams);
    });
  }

  /**
   * Mint one login code and put its holder straight onto a team. The plaintext
   * code exists right here, so the member key can be derived without ever
   * asking for a CSV. The codes file is handed over exactly as the Roster tab
   * does it — and it is handed over even if the placement then fails, because
   * the student now exists and nothing else holds their code.
   */
  function addNewStudent(toLabel: string): Promise<boolean> {
    return guarded(async () => {
      if (!base) throw new Error("The team directory is not loaded.");
      const minted = await mintStudents(sid, session, students, 1);
      const result = await commitAddedStudents(sid, minted);
      if (!result.ok) throw new Error(`${result.refused} Nothing was added and no code was issued.`);
      downloadFile(minted.bundle.filename, minted.bundle.csv, "text/csv");
      setAdded(minted.bundle);
      const entry = minted.roster[0];
      try {
        await reprovision(
          applyTeamEdit(base.teams, {
            type: "add",
            member: { codeIndex: entry.codeIndex, codeHash: entry.hash, code: minted.codes[0] },
            toLabel,
          }),
        );
      } catch (e) {
        throw new Error(
          `Student #${entry.codeIndex} was added to the session but could not be placed on a team: ${errMsg(e)} ` +
            `They are listed under "Not on a team" — place them from there.`,
        );
      }
    });
  }

  /**
   * Place a student who already has a code but no team — added on the Roster
   * tab after provisioning — by typing their code. The code is the only way to
   * their key; it is hashed to check it belongs to somebody here, used once to
   * derive the key, and dropped.
   */
  function placeByCode(code: string, toLabel: string): Promise<boolean> {
    return guarded(async () => {
      if (!base) throw new Error("The team directory is not loaded.");
      const codeHash = await hashCode(code);
      const student = students.find((s) => s.hash === codeHash);
      if (!student) throw new Error("That login code does not belong to a student in this session.");
      const onTeam = base.teams.some((t) => t.members.some((m) => m.codeHash === codeHash));
      const edit: TeamEdit = onTeam
        ? { type: "move", codeHash, toLabel }
        : {
            type: "add",
            member: { codeIndex: student.codeIndex, codeHash, memberKeyRaw: await deriveMemberKeyRaw(sid, code) },
            toLabel,
          };
      await reprovision(applyTeamEdit(base.teams, edit));
    });
  }

  return {
    base,
    unassigned,
    canEdit,
    busy,
    progress,
    error,
    added,
    dismissAdded: () => setAdded(null),
    run,
    removeFromSession,
    addNewStudent,
    placeByCode,
  };
}

export type TeamEdits = ReturnType<typeof useTeamEdits>;
