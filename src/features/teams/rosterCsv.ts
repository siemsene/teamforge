// Parse and validate the instructor's roster CSV for team management.
//
// Normally this is the login-codes CSV exactly as downloaded at session
// creation, with nothing added: the team for each student comes from the saved
// allocation instead (see allocationTeams.ts). A `team` column is still
// honoured and overrides the allocation, for an instructor who moved somebody
// afterwards or never ran the optimizer. We accept either the login code or the
// code index to identify each student, so either column will do. Pure module —
// unit-testable; the caller does the code→hash resolution (async crypto) and
// cross-checks against the existing student docs.
//
// A `name` column is tolerated but never uploaded: the instructor's working
// sheet usually carries names, and it would be hostile to make them strip it.
// Names parsed here are used only for the on-screen preview in the
// instructor's own browser, so they can confirm they picked the right file.
// Students choose their own display names (see lib/nicknames.ts).

import { parseCsv } from "../../lib/util";

export interface RosterRow {
  /** Login code as written (may be blank if the sheet used index instead). */
  code: string;
  /** Code index as written (may be blank if the sheet used code instead). */
  index: number | null;
  /** Preview only — never sealed into any artifact. Empty when absent. */
  name: string;
  /** Empty when the file carries no team column; filled from the allocation. */
  team: string;
}

export interface ParsedRoster {
  rows: RosterRow[];
  problems: string[];
  /** True when the file supplies its own team labels, overriding the allocation. */
  hasTeamColumn: boolean;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, "");

/** Find the column index whose header matches any of the given aliases. */
function findColumn(header: string[], aliases: string[]): number {
  const normalized = header.map(norm);
  for (const alias of aliases) {
    const i = normalized.indexOf(norm(alias));
    if (i >= 0) return i;
  }
  return -1;
}

export function parseRosterCsv(text: string): ParsedRoster {
  const grid = parseCsv(text);
  if (grid.length === 0) return { rows: [], problems: ["The file is empty."], hasTeamColumn: false };

  const header = grid[0];
  const codeCol = findColumn(header, ["code", "login code", "logincode", "student code"]);
  const indexCol = findColumn(header, ["index", "code index", "codeindex", "#", "number", "studentindex"]);
  const nameCol = findColumn(header, ["name", "student name", "studentname", "yourstudentname"]);
  const teamCol = findColumn(header, ["team", "team label", "teamname", "team name", "group"]);

  const problems: string[] = [];
  if (codeCol < 0 && indexCol < 0)
    problems.push('The file needs a "code" or "index" column to identify each student.');
  if (problems.length > 0) return { rows: [], problems, hasTeamColumn: teamCol >= 0 };

  const rows: RosterRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const line = grid[r];
    const code = codeCol >= 0 ? (line[codeCol] ?? "").trim() : "";
    const indexRaw = indexCol >= 0 ? (line[indexCol] ?? "").trim() : "";
    const name = nameCol >= 0 ? (line[nameCol] ?? "").trim() : "";
    const team = teamCol >= 0 ? (line[teamCol] ?? "").trim() : "";
    const index = indexRaw ? Number(indexRaw) : null;

    if (!code && index == null) {
      problems.push(`Row ${r + 1}: no login code or index.`);
      continue;
    }
    if (index != null && !Number.isInteger(index)) {
      problems.push(`Row ${r + 1}: index "${indexRaw}" is not a whole number.`);
      continue;
    }
    // A blank team is normal — the allocation supplies it. Only a row in a file
    // that does carry team labels, yet leaves this one empty, is worth flagging.
    if (teamCol >= 0 && !team) problems.push(`Row ${r + 1}: missing team.`);
    rows.push({ code, index, name, team });
  }
  return { rows, problems, hasTeamColumn: teamCol >= 0 };
}

export interface TeamGroup {
  label: string;
  members: RosterRow[];
}

/** Group parsed rows by team label, preserving first-seen order. */
export function groupByTeam(rows: RosterRow[]): TeamGroup[] {
  const map = new Map<string, RosterRow[]>();
  for (const row of rows) {
    if (!map.has(row.team)) map.set(row.team, []);
    map.get(row.team)!.push(row);
  }
  return [...map.entries()].map(([label, members]) => ({ label, members }));
}
