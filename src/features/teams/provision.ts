// Roster provisioning: turn the instructor's validated roster (codes + names +
// teams, held in memory) into the encrypted Firestore artifacts. Runs entirely
// in the instructor's browser; plaintext names never leave it.

import { eciesEncrypt, toBase64 } from "../../lib/crypto";
import { hashCode } from "../../lib/codes";
import {
  deriveMemberKey,
  deriveMemberKeyRaw,
  generateTeamToken,
  hashTeamToken,
  sealEnvelope,
} from "../../lib/memberKey";
import type {
  AesEnvelope,
  ContractState,
  EciesPayload,
  RosterInfo,
  TeamDirectory,
  TeamDoc,
} from "../../types";
import type { RosterRow } from "./rosterCsv";

export interface ResolvedMember {
  codeIndex: number;
  codeHash: string;
  /** The login code, needed to derive the member key. */
  code: string;
  name: string;
}

export interface ResolvedTeam {
  label: string;
  members: ResolvedMember[];
}

const emptyContract = (): ContractState => ({
  status: "empty",
  updatedAt: null,
  updatedByCodeIndex: null,
  content: null,
  contentForInstructor: null,
  feedback: null,
  feedbackAt: null,
  finalizedAt: null,
});

export interface ProvisionResult {
  studentPatches: { hash: string; roster: AesEnvelope }[];
  teamDocs: { tokenHash: string; team: TeamDoc }[];
  directoryPayload: EciesPayload;
}

/**
 * Derives keys and seals every artifact. `onProgress` is called as each member
 * key is derived (the slow part — one PBKDF2 per student).
 */
export async function buildProvisioning(
  sid: string,
  sessionPublicKeyJwk: JsonWebKey,
  teams: ResolvedTeam[],
  onProgress?: (done: number, total: number) => void,
): Promise<ProvisionResult> {
  const totalMembers = teams.reduce((n, t) => n + t.members.length, 0);
  let done = 0;

  const studentPatches: { hash: string; roster: AesEnvelope }[] = [];
  const teamDocs: { tokenHash: string; team: TeamDoc }[] = [];
  const directory: TeamDirectory = { createdAt: Date.now(), teams: [], memberKeys: {} };

  for (const team of teams) {
    const token = generateTeamToken();
    const tokenHash = await hashTeamToken(token);
    teamDocs.push({
      tokenHash,
      team: { teamLabel: team.label, createdAt: Date.now(), contract: emptyContract() },
    });
    directory.teams.push({
      token,
      label: team.label,
      members: team.members.map((m) => ({ codeIndex: m.codeIndex, codeHash: m.codeHash, name: m.name })),
    });

    for (const member of team.members) {
      const roster: RosterInfo = {
        codeIndex: member.codeIndex,
        name: member.name,
        teamToken: token,
        teamLabel: team.label,
        teammates: team.members
          .filter((o) => o.codeIndex !== member.codeIndex)
          .map((o) => ({ codeIndex: o.codeIndex, name: o.name })),
      };
      const memberKey = await deriveMemberKey(sid, member.code);
      const sealed = await sealEnvelope(memberKey, JSON.stringify(roster));
      studentPatches.push({ hash: member.codeHash, roster: sealed });
      directory.memberKeys[member.codeHash] = toBase64(await deriveMemberKeyRaw(sid, member.code));
      done += 1;
      onProgress?.(done, totalMembers);
    }
  }

  const directoryPayload = await eciesEncrypt(sessionPublicKeyJwk, JSON.stringify(directory));
  return { studentPatches, teamDocs, directoryPayload };
}

/**
 * Resolve validated roster rows against the existing student docs. Returns the
 * teams ready for provisioning, or a list of problems (unknown codes/indexes,
 * duplicates). Needs the codes to derive keys, so rows must carry a login code —
 * when the sheet used only indexes, `codesByIndex` supplies them.
 */
export async function resolveRoster(
  students: { hash: string; codeIndex: number }[],
  teamsByLabel: { label: string; members: RosterRow[] }[],
  codesByIndex?: Map<number, string>,
): Promise<{ teams: ResolvedTeam[]; problems: string[] }> {
  const problems: string[] = [];
  const hashByIndex = new Map(students.map((s) => [s.codeIndex, s.hash]));
  const knownHashes = new Set(students.map((s) => s.hash));
  const seen = new Set<string>();

  const resolveOne = async (row: RosterRow): Promise<ResolvedMember | null> => {
    let code = row.code;
    let codeIndex = row.index ?? undefined;
    let codeHash: string | undefined;

    if (code) {
      codeHash = await hashCode(code);
      if (!knownHashes.has(codeHash)) {
        problems.push(`Login code for "${row.name || "a row"}" does not match any student in this session.`);
        return null;
      }
      const match = students.find((s) => s.hash === codeHash);
      codeIndex = match?.codeIndex;
    } else if (codeIndex != null) {
      const hash = hashByIndex.get(codeIndex);
      if (!hash) {
        problems.push(`Index ${codeIndex} ("${row.name}") is not a student in this session.`);
        return null;
      }
      codeHash = hash;
      const supplied = codesByIndex?.get(codeIndex);
      if (!supplied) {
        problems.push(`No login code available for index ${codeIndex} ("${row.name}") — provide the codes CSV.`);
        return null;
      }
      code = supplied;
    } else {
      return null;
    }

    if (seen.has(codeHash)) {
      problems.push(`"${row.name}" appears more than once in the roster.`);
      return null;
    }
    seen.add(codeHash);
    return { codeIndex: codeIndex!, codeHash, code, name: row.name };
  };

  const teams: ResolvedTeam[] = [];
  for (const group of teamsByLabel) {
    const members: ResolvedMember[] = [];
    for (const row of group.members) {
      const resolved = await resolveOne(row);
      if (resolved) members.push(resolved);
    }
    if (members.length > 0) teams.push({ label: group.label, members });
  }
  return { teams, problems };
}
