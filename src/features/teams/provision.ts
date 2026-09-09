// Roster provisioning: turn the instructor's validated roster (codes + teams,
// held in memory) into the encrypted Firestore artifacts. Runs entirely in the
// instructor's browser.
//
// No names are involved: the instructor asserts only which code index sits on
// which team. Display names are nicknames students choose for themselves and
// seal under the team key, so the platform never receives an
// instructor-asserted identity at all.

import { eciesEncrypt, toBase64 } from "../../lib/crypto";
import { hashCode } from "../../lib/codes";
import {
  deriveMemberKeyRaw,
  generateTeamToken,
  hashTeamToken,
  importMemberKey,
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

/**
 * A student to place on a team. The member key comes from one of two places:
 *
 *   - `code`: the login code, from the instructor's CSV. The key is derived
 *     from it with PBKDF2 (slow, deliberately).
 *   - `memberKeyRaw`: the key itself, read back out of the previous encrypted
 *     team directory. This is what lets an instructor move or remove a student
 *     who is already provisioned without handing the codes CSV over again.
 *
 * One of the two is required; `memberKeyRaw` wins when both are present.
 */
export interface ResolvedMember {
  codeIndex: number;
  codeHash: string;
  code?: string;
  memberKeyRaw?: Uint8Array;
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
  /** Teams to write. `reused` teams keep an existing doc, so the caller must
   * not overwrite its contract or nicknames. */
  teamDocs: { tokenHash: string; team: TeamDoc; reused: boolean }[];
  /** Token hashes of teams in the previous directory that no longer exist. */
  staleTokenHashes: string[];
  directoryPayload: EciesPayload;
  /** The directory in the clear, so a caller that already holds the previous
   * one can carry on without decrypting what it just wrote. */
  directory: TeamDirectory;
}

async function memberKeyRawFor(sid: string, member: ResolvedMember): Promise<Uint8Array> {
  if (member.memberKeyRaw) return member.memberKeyRaw;
  if (member.code) return deriveMemberKeyRaw(sid, member.code);
  throw new Error(`No login code or member key for student #${member.codeIndex}.`);
}

/**
 * Derives keys and seals every artifact. `onProgress` is called as each member
 * is sealed (the slow part is one PBKDF2 per student whose key is not already
 * known).
 *
 * `previous` is the directory from an earlier provisioning run, when there is
 * one. A team's doc id is the hash of its token, and the contract and everyone's
 * chosen display names live in that doc — so minting a fresh token for a team
 * that already exists silently orphans all of it. Any team whose label we have
 * seen before therefore keeps its token, and only genuinely new teams get a new
 * one. Labels that have disappeared are reported back for deletion.
 *
 * A team handed in with no members is still written (label only, token kept):
 * emptying a team by moving its last student out must not delete the contract
 * they wrote. Dropping a team is the caller's explicit decision, made by
 * leaving it out of `teams`.
 */
export async function buildProvisioning(
  sid: string,
  sessionPublicKeyJwk: JsonWebKey,
  teams: ResolvedTeam[],
  onProgress?: (done: number, total: number) => void,
  previous?: TeamDirectory | null,
): Promise<ProvisionResult> {
  const totalMembers = teams.reduce((n, t) => n + t.members.length, 0);
  let done = 0;

  const previousByLabel = new Map((previous?.teams ?? []).map((t) => [t.label, t]));
  const keptLabels = new Set(teams.map((t) => t.label));
  const placedIndexes = new Set(teams.flatMap((t) => t.members.map((m) => m.codeIndex)));

  const studentPatches: { hash: string; roster: AesEnvelope }[] = [];
  const teamDocs: { tokenHash: string; team: TeamDoc; reused: boolean }[] = [];
  const directory: TeamDirectory = { createdAt: Date.now(), teams: [], memberKeys: {} };

  for (const team of teams) {
    const old = previousByLabel.get(team.label);
    const token = old?.token ?? generateTeamToken();
    const tokenHash = await hashTeamToken(token);
    teamDocs.push({
      tokenHash,
      team: { teamLabel: team.label, createdAt: Date.now(), contract: emptyContract(), nicknames: {} },
      reused: old != null,
    });

    // Who used to be on this team and is now on another one. Anyone who has
    // left the session entirely is covered by session.retiredCodeIndexes, and
    // anyone who came back to this team is a member again, so neither belongs
    // here.
    const current = new Set(team.members.map((m) => m.codeIndex));
    const former = new Set<number>();
    for (const idx of old?.formerCodeIndexes ?? []) if (!current.has(idx)) former.add(idx);
    for (const m of old?.members ?? []) {
      if (!current.has(m.codeIndex) && placedIndexes.has(m.codeIndex)) former.add(m.codeIndex);
    }

    directory.teams.push({
      token,
      label: team.label,
      members: team.members.map((m) => ({ codeIndex: m.codeIndex, codeHash: m.codeHash })),
      ...(former.size > 0 ? { formerCodeIndexes: [...former].sort((a, b) => a - b) } : {}),
    });

    for (const member of team.members) {
      const roster: RosterInfo = {
        codeIndex: member.codeIndex,
        teamToken: token,
        teamLabel: team.label,
        teammates: team.members
          .filter((o) => o.codeIndex !== member.codeIndex)
          .map((o) => ({ codeIndex: o.codeIndex })),
      };
      const raw = await memberKeyRawFor(sid, member);
      const memberKey = await importMemberKey(raw);
      const sealed = await sealEnvelope(memberKey, JSON.stringify(roster));
      studentPatches.push({ hash: member.codeHash, roster: sealed });
      directory.memberKeys[member.codeHash] = toBase64(raw);
      done += 1;
      onProgress?.(done, totalMembers);
    }
  }

  // Teams that were in the old directory and are not in the new roster. Their
  // docs would otherwise linger and show up twice on the instructor's Teams tab.
  const staleTokenHashes: string[] = [];
  for (const old of previous?.teams ?? []) {
    if (!keptLabels.has(old.label)) staleTokenHashes.push(await hashTeamToken(old.token));
  }

  const directoryPayload = await eciesEncrypt(sessionPublicKeyJwk, JSON.stringify(directory));
  return { studentPatches, teamDocs, staleTokenHashes, directoryPayload, directory };
}

/** How to refer to a roster row in an error message. Prefers the preview-only
 * name when the sheet had one (it never leaves the instructor's browser), and
 * falls back to the code index. */
function rowLabel(row: RosterRow): string {
  if (row.name) return `"${row.name}"`;
  if (row.index != null) return `index ${row.index}`;
  return "a row";
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
): Promise<{ teams: ResolvedTeam[]; problems: string[]; previewNames: Map<number, string> }> {
  const problems: string[] = [];
  // Names from the instructor's sheet, kept only so the on-screen preview can
  // confirm the right file was picked. Deliberately not part of ResolvedMember,
  // so they cannot reach buildProvisioning and be sealed into anything.
  const previewNames = new Map<number, string>();
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
        problems.push(`Login code for ${rowLabel(row)} does not match any student in this session.`);
        return null;
      }
      const match = students.find((s) => s.hash === codeHash);
      codeIndex = match?.codeIndex;
    } else if (codeIndex != null) {
      const hash = hashByIndex.get(codeIndex);
      if (!hash) {
        problems.push(`Index ${codeIndex} (${rowLabel(row)}) is not a student in this session.`);
        return null;
      }
      codeHash = hash;
      const supplied = codesByIndex?.get(codeIndex);
      if (!supplied) {
        problems.push(`No login code available for index ${codeIndex} (${rowLabel(row)}) — provide the codes CSV.`);
        return null;
      }
      code = supplied;
    } else {
      return null;
    }

    if (seen.has(codeHash)) {
      problems.push(`${rowLabel(row)} appears more than once in the roster.`);
      return null;
    }
    seen.add(codeHash);
    if (row.name) previewNames.set(codeIndex!, row.name);
    return { codeIndex: codeIndex!, codeHash, code };
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
  return { teams, problems, previewNames };
}
