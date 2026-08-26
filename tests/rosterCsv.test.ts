import { describe, expect, it } from "vitest";
import { groupByTeam, parseRosterCsv } from "../src/features/teams/rosterCsv";
import { toCsv } from "../src/lib/util";

describe("parseRosterCsv", () => {
  it("parses code/name/team with a header", () => {
    const csv = toCsv([
      ["code", "name", "team"],
      ["ABCDE-FGHJK", "Ana Ng", "Team 1"],
      ["MNPQR-STVWX", "Ben Ho", "Team 1"],
    ]);
    const { rows, problems } = parseRosterCsv(csv);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ code: "ABCDE-FGHJK", name: "Ana Ng", team: "Team 1", index: null });
  });

  it("accepts index instead of code and tolerates header aliases", () => {
    const csv = toCsv([
      ["#", "Student Name", "Group"],
      ["1", "Ana Ng", "Alpha"],
      ["2", "Ben Ho", "Beta"],
    ]);
    const { rows, problems } = parseRosterCsv(csv);
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ index: 1, name: "Ana Ng", team: "Alpha", code: "" });
  });

  it("handles quoted names with commas", () => {
    const csv = 'code,name,team\r\nABCDE-FGHJK,"Ng, Ana",Team 1\r\n';
    const { rows } = parseRosterCsv(csv);
    expect(rows[0].name).toBe("Ng, Ana");
  });

  it("flags a missing required column", () => {
    const { problems } = parseRosterCsv(toCsv([["code", "name"], ["ABCDE-FGHJK", "Ana"]]));
    expect(problems.join(" ")).toMatch(/needs a "team" column/);
  });

  it("accepts a file with no name column at all — only team membership matters", () => {
    const csv = toCsv([
      ["code", "team"],
      ["ABCDE-FGHJK", "Team 1"],
      ["MNPQR-STVWX", "Team 2"],
    ]);
    const { rows, problems } = parseRosterCsv(csv);
    expect(problems).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("");
    expect(rows[0].team).toBe("Team 1");
  });

  it("tolerates a blank name but still requires a team", () => {
    const csv = toCsv([
      ["code", "name", "team"],
      ["ABCDE-FGHJK", "", "Team 1"],
      ["MNPQR-STVWX", "Ben Ho", ""],
    ]);
    const { rows, problems } = parseRosterCsv(csv);
    expect(rows).toHaveLength(2);
    expect(problems.join(" ")).not.toMatch(/missing name/);
    expect(problems.join(" ")).toMatch(/missing team/);
  });

  it("rejects a non-numeric index", () => {
    const csv = toCsv([["index", "name", "team"], ["x", "Ana", "Team 1"]]);
    const { problems } = parseRosterCsv(csv);
    expect(problems.join(" ")).toMatch(/not a whole number/);
  });
});

describe("groupByTeam", () => {
  it("groups rows by team label in first-seen order", () => {
    const { rows } = parseRosterCsv(
      toCsv([
        ["code", "name", "team"],
        ["A", "Ana", "Team 2"],
        ["B", "Ben", "Team 1"],
        ["C", "Cara", "Team 2"],
      ]),
    );
    const groups = groupByTeam(rows);
    expect(groups.map((g) => g.label)).toEqual(["Team 2", "Team 1"]);
    expect(groups[0].members.map((m) => m.name)).toEqual(["Ana", "Cara"]);
  });
});
