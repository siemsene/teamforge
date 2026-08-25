// Parse and validate the instructor's completed roster CSV for team management.
//
// The instructor starts from the login-codes CSV downloaded at session
// creation and adds a name and a team label per row. We accept either the
// login code or the code index to identify each student, so the instructor can
// work from whichever column is convenient. Pure module — unit-testable; the
// caller does the code→hash resolution (async crypto) and cross-checks against
// the existing student docs.

import { parseCsv } from "../../lib/util";

export interface RosterRow {
  /** Login code as written (may be blank if the sheet used index instead). */
  code: string;
  /** Code index as written (may be blank if the sheet used code instead). */
  index: number | null;
  name: string;
  team: string;
}

export interface ParsedRoster {
  rows: RosterRow[];
  problems: string[];
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
  if (grid.length === 0) return { rows: [], problems: ["The file is empty."] };

  const header = grid[0];
  const codeCol = findColumn(header, ["code", "login code", "logincode", "student code"]);
  const indexCol = findColumn(header, ["index", "code index", "codeindex", "#", "number", "studentindex"]);
  const nameCol = findColumn(header, ["name", "student name", "studentname", "yourstudentname"]);
  const teamCol = findColumn(header, ["team", "team label", "teamname", "team name", "group"]);

  const problems: string[] = [];
  if (codeCol < 0 && indexCol < 0)
    problems.push('The file needs a "code" or "index" column to identify each student.');
  if (nameCol < 0) problems.push('The file needs a "name" column.');
  if (teamCol < 0) problems.push('The file needs a "team" column.');
  if (problems.length > 0) return { rows: [], problems };

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
    if (!name) problems.push(`Row ${r + 1}: missing name.`);
    if (!team) problems.push(`Row ${r + 1}: missing team.`);
    rows.push({ code, index, name, team });
  }
  return { rows, problems };
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
