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

  it("accepts the codes CSV unchanged, with no team column", () => {
    // The normal path: teams come from the saved allocation, so the instructor
    // uploads the file exactly as downloaded rather than hand-merging one.
    const { rows, problems, hasTeamColumn } = parseRosterCsv(
      toCsv([
        ["studentIndex", "loginCode", "shareCode", "surveyLink", "yourStudentName", "yourStudentEmail"],
        ["1", "ABCDE-FGHJK", "WXYZ", "https://example.test/s/abc", "Ana", "ana@example.test"],
        ["2", "MNPQR-STVWX", "QRST", "https://example.test/s/abc", "Ben", "ben@example.test"],
      ]),
    );
    expect(problems).toEqual([]);
    expect(hasTeamColumn).toBe(false);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.team)).toEqual(["", ""]);
    expect(rows.map((r) => r.index)).toEqual([1, 2]);
    expect(rows[0].code).toBe("ABCDE-FGHJK");
    expect(rows[0].name).toBe("Ana"); // preview only
  });

  it("still needs something that identifies each student", () => {
    const { problems } = parseRosterCsv(toCsv([["name", "team"], ["Ana", "Team 1"]]));
    expect(problems.join(" ")).toMatch(/needs a "code" or "index" column/);
  });

  it("reports a blank cell only in a file that does use a team column", () => {
    const withColumn = parseRosterCsv(
      toCsv([["code", "team"], ["ABCDE-FGHJK", "Team 1"], ["MNPQR-STVWX", ""]]),
    );
    expect(withColumn.hasTeamColumn).toBe(true);
    expect(withColumn.problems.join(" ")).toMatch(/Row 3: missing team/);

    const withoutColumn = parseRosterCsv(toCsv([["code"], ["ABCDE-FGHJK"]]));
    expect(withoutColumn.problems).toEqual([]);
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
