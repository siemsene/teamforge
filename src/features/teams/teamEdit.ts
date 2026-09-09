// Pure helpers behind editing provisioned teams by hand: moving a student to
// another team, adding one, removing one, deleting a team that has emptied.
//
// No Firestore, no crypto, no React — the same reasoning as rosterEdit.ts. The
// one input that came out of crypto is the previous team directory, decrypted
// by the caller; everything here is arithmetic on it, and so directly testable.
//
// Every edit is expressed as "the teams as they should be next", handed to
// buildProvisioning with the previous directory, which re-seals every member's
// roster blob and keeps each surviving team's token (and so its contract and
// display names). The member keys come out of the previous directory, so none of
// this needs the login-codes CSV — the whole reason the Teams tab used to send
// the instructor back to a file upload for a one-student change.

import { fromBase64 } from "../../lib/crypto";
import type {
  ContractStatus,
  EvalRoundId,
  RoundStatus,
  SessionStatus,
  TeamDirectory,
} from "../../types";
import type { ResolvedMember, ResolvedTeam } from "./provision";

export interface LiveStudent {
  hash: string;
  codeIndex: number;
}

export interface DirectoryTeams {
  teams: ResolvedTeam[];
  /** Members still on the roster whose key the directory does not hold. A
   * directory written before member keys were stored is the only way this
   * happens; the caller must not rebuild without them, because a member with
   * no key cannot be re-sealed and would silently fall off their team. */
  missingKey: { codeIndex: number; label: string }[];
}

/**
 * The provisioned teams, as the starting point for an edit.
 *
 * Students who have since been removed from the session are dropped here rather
 * than carried along: their document is gone, and a batch that tries to update
 * it fails as a whole. The directory is the record of who each ballot was
 * written against, but that is EvalReview's concern, not this one's.
 */
export function teamsFromDirectory(directory: TeamDirectory, live: LiveStudent[]): DirectoryTeams {
  const liveHashes = new Set(live.map((s) => s.hash));
  const missingKey: { codeIndex: number; label: string }[] = [];
  const teams: ResolvedTeam[] = directory.teams.map((team) => {
    const members: ResolvedMember[] = [];
    for (const m of team.members) {
      if (!liveHashes.has(m.codeHash)) continue;
      const rawB64 = directory.memberKeys[m.codeHash];
      if (!rawB64) {
        missingKey.push({ codeIndex: m.codeIndex, label: team.label });
        continue;
      }
      members.push({ codeIndex: m.codeIndex, codeHash: m.codeHash, memberKeyRaw: fromBase64(rawB64) });
    }
    return { label: team.label, members };
  });
  return { teams, missingKey };
}

/** Live students the directory places on no team — typically added on the
 * Roster tab after provisioning. Sorted by index. */
export function unassignedStudents(directory: TeamDirectory, live: LiveStudent[]): LiveStudent[] {
  const placed = new Set(directory.teams.flatMap((t) => t.members.map((m) => m.codeHash)));
  return live.filter((s) => !placed.has(s.hash)).sort((a, b) => a.codeIndex - b.codeIndex);
}

/** A label as it will be stored: trimmed, inner whitespace collapsed. */
export function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

/** How two labels are compared: "team 3" and "Team 3 " are the same team. A
 * new team that differs from an existing one only this way would be a second
 * team nobody asked for. */
export function labelKey(label: string): string {
  return normalizeLabel(label).toLocaleLowerCase();
}

export function findTeam(teams: ResolvedTeam[], label: string): ResolvedTeam | undefined {
  const key = labelKey(label);
  return teams.find((t) => labelKey(t.label) === key);
}

export type TeamEdit =
  | { type: "move"; codeHash: string; toLabel: string }
  | { type: "remove"; codeHash: string }
  | { type: "add"; member: ResolvedMember; toLabel: string }
  | { type: "deleteTeam"; label: string }
  /** No change: rebuild as-is, which drops students removed since. */
  | { type: "sync" };

function locate(teams: ResolvedTeam[], codeHash: string): { team: ResolvedTeam; member: ResolvedMember } {
  for (const team of teams) {
    const member = team.members.find((m) => m.codeHash === codeHash);
    if (member) return { team, member };
  }
  throw new Error("That student is not on any team.");
}

function without(teams: ResolvedTeam[], codeHash: string): ResolvedTeam[] {
  return teams.map((t) => ({ label: t.label, members: t.members.filter((m) => m.codeHash !== codeHash) }));
}

function placed(teams: ResolvedTeam[], member: ResolvedMember, toLabel: string): ResolvedTeam[] {
  const label = normalizeLabel(toLabel);
  if (!label) throw new Error("Give the team a name.");
  const target = findTeam(teams, label);
  if (!target) return [...teams.map((t) => ({ label: t.label, members: [...t.members] })), { label, members: [member] }];
  return teams.map((t) => (t === target ? { label: t.label, members: [...t.members, member] } : { label: t.label, members: [...t.members] }));
}

/**
 * The teams after one edit. Never mutates its input.
 *
 * A team left with no members stays in the list. Provisioning writes it label-
 * only and keeps its token, so the contract its members wrote survives the last
 * of them moving out. Deleting it is a separate, explicit edit.
 */
export function applyTeamEdit(teams: ResolvedTeam[], edit: TeamEdit): ResolvedTeam[] {
  switch (edit.type) {
    case "sync":
      return teams.map((t) => ({ label: t.label, members: [...t.members] }));
    case "remove":
      locate(teams, edit.codeHash);
      return without(teams, edit.codeHash);
    case "move": {
      const { team, member } = locate(teams, edit.codeHash);
      const target = findTeam(teams, edit.toLabel);
      if (target === team) return applyTeamEdit(teams, { type: "sync" });
      return placed(without(teams, edit.codeHash), member, edit.toLabel);
    }
    case "add": {
      if (teams.some((t) => t.members.some((m) => m.codeHash === edit.member.codeHash))) {
        throw new Error(`Student #${edit.member.codeIndex} is already on a team.`);
      }
      return placed(teams, edit.member, edit.toLabel);
    }
    case "deleteTeam": {
      const target = findTeam(teams, edit.label);
      if (!target) throw new Error("No such team.");
      if (target.members.length > 0) throw new Error("Only a team with no members can be deleted.");
      return teams.filter((t) => t !== target).map((t) => ({ label: t.label, members: [...t.members] }));
    }
  }
}

export interface MovedMember {
  codeIndex: number;
  codeHash: string;
  fromLabel: string;
  /** The old team's token — its doc holds the display name this student chose
   * there, sealed under a key their new team does not have. */
  fromToken: string;
  toLabel: string;
}

/** Students present in both the previous directory and the next roster, on a
 * different team. */
export function movedMembers(previous: TeamDirectory, next: ResolvedTeam[]): MovedMember[] {
  const nextLabelByHash = new Map<string, string>();
  for (const t of next) for (const m of t.members) nextLabelByHash.set(m.codeHash, t.label);
  const out: MovedMember[] = [];
  for (const t of previous.teams) {
    for (const m of t.members) {
      const toLabel = nextLabelByHash.get(m.codeHash);
      if (toLabel != null && toLabel !== t.label) {
        out.push({ codeIndex: m.codeIndex, codeHash: m.codeHash, fromLabel: t.label, fromToken: t.token, toLabel });
      }
    }
  }
  return out.sort((a, b) => a.codeIndex - b.codeIndex);
}

// ---------- warnings ----------

export type TeamEditWarning =
  /** The student's ballot in an open round is withdrawn; they fill it in again for the new team. */
  | "ballotWithdrawn"
  /** The student's ballot in a closed round names the old team and will be excluded at review. */
  | "ballotExcluded"
  /** A round is open: teammates who have already submitted did not rate this student. */
  | "roundOpen"
  /** The team being left has a finalized contract. */
  | "contractFinalized"
  /** Display names are sealed per team; the student picks one again. */
  | "nicknameReset"
  /** A departed student keeps the old team's key. */
  | "teamKeyRetained"
  /** The team being left will have nobody on it. */
  | "teamLeftEmpty"
  /** The target label does not exist yet. */
  | "newTeam"
  /** The session is not open, so a newcomer cannot answer the survey. */
  | "surveyClosed";

export interface TeamEditContext {
  teams: ResolvedTeam[];
  sessionStatus: SessionStatus;
  rounds: Record<EvalRoundId, { status: RoundStatus; resultsPublished?: boolean }>;
  /** Team label -> contract status of its doc. */
  contractStatus: Map<string, ContractStatus>;
  /** The affected student's submissions by round, when the edit names one. */
  submitted?: Partial<Record<EvalRoundId, boolean>>;
}

const ROUNDS: EvalRoundId[] = ["formative", "summative"];

/**
 * What this edit will do beyond moving a name from one list to another, so the
 * confirmation can say it. Returned in a fixed order, worst first.
 */
export function teamEditWarnings(edit: TeamEdit, ctx: TeamEditContext): TeamEditWarning[] {
  const out = new Set<TeamEditWarning>();
  const anyOpen = ROUNDS.some((r) => ctx.rounds[r].status === "open");
  const source =
    edit.type === "move" || edit.type === "remove"
      ? ctx.teams.find((t) => t.members.some((m) => m.codeHash === edit.codeHash))
      : undefined;

  if (edit.type === "move") {
    for (const r of ROUNDS) {
      if (!ctx.submitted?.[r]) continue;
      const round = ctx.rounds[r];
      if (round.status === "open") out.add("ballotWithdrawn");
      else if (round.status === "closed" && !round.resultsPublished) out.add("ballotExcluded");
    }
    out.add("nicknameReset");
    out.add("teamKeyRetained");
  }
  if ((edit.type === "move" || edit.type === "add") && anyOpen) out.add("roundOpen");
  if (source && ctx.contractStatus.get(source.label) === "final") out.add("contractFinalized");
  if (source && source.members.length === 1) out.add("teamLeftEmpty");
  if ((edit.type === "move" || edit.type === "add") && !findTeam(ctx.teams, edit.toLabel)) out.add("newTeam");
  if (edit.type === "add" && ctx.sessionStatus !== "open") out.add("surveyClosed");

  const ORDER: TeamEditWarning[] = [
    "ballotWithdrawn",
    "ballotExcluded",
    "roundOpen",
    "contractFinalized",
    "teamLeftEmpty",
    "newTeam",
    "nicknameReset",
    "teamKeyRetained",
    "surveyClosed",
  ];
  return ORDER.filter((w) => out.has(w));
}

/** The warnings in the instructor's terms. */
export const TEAM_EDIT_WARNING_TEXT: Record<TeamEditWarning, string> = {
  ballotWithdrawn:
    "They already submitted a peer evaluation in the round that is open. It was written about their old teammates, so it is withdrawn; they will be asked to fill one in for the new team.",
  ballotExcluded:
    "They submitted a peer evaluation in a round that is now closed. It names their old team, so it will be excluded when you review that round, and they will be treated as not having submitted.",
  roundOpen:
    "A peer-evaluation round is open. Teammates who have already submitted did not rate this student, so their factor for this round rests on fewer raters.",
  contractFinalized: "The team they are leaving has a finalized contract. It stays as it is, without them.",
  teamLeftEmpty:
    "This leaves their old team with nobody on it. The team and its contract are kept; you can delete the team afterwards if you want it gone.",
  newTeam: "That team does not exist yet, so it will be created, with an empty contract.",
  nicknameReset:
    "Display names are sealed per team, so the name they chose does not travel with them. They pick one again on the new team; their old teammates see their number until then.",
  teamKeyRetained:
    "Moving them does not take back the key to their old team's contract. Someone who kept it can still read and edit that contract while team management is on. To cut that off, re-upload the roster giving that team a different label.",
  surveyClosed:
    "This session is not open, so the new student cannot answer the survey. They can still log in to see their team, the contract and any peer-evaluation round.",
};
