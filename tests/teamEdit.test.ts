import { describe, expect, it } from "vitest";
import {
  applyTeamEdit,
  findTeam,
  labelKey,
  movedMembers,
  normalizeLabel,
  teamEditWarnings,
  teamsFromDirectory,
  unassignedStudents,
  type TeamEditContext,
} from "../src/features/teams/teamEdit";
import type { ResolvedTeam } from "../src/features/teams/provision";
import { toBase64 } from "../src/lib/crypto";
import type { TeamDirectory } from "../src/types";

const key = (n: number) => new Uint8Array(32).fill(n);
const live = (...indexes: number[]) => indexes.map((codeIndex) => ({ codeIndex, hash: `hash${codeIndex}` }));

const directory: TeamDirectory = {
  createdAt: 0,
  teams: [
    { token: "tokA", label: "Team 1", members: [{ codeIndex: 1, codeHash: "hash1" }, { codeIndex: 2, codeHash: "hash2" }] },
    { token: "tokB", label: "Team 2", members: [{ codeIndex: 3, codeHash: "hash3" }, { codeIndex: 4, codeHash: "hash4" }] },
  ],
  memberKeys: { hash1: toBase64(key(1)), hash2: toBase64(key(2)), hash3: toBase64(key(3)), hash4: toBase64(key(4)) },
};

const base: ResolvedTeam[] = teamsFromDirectory(directory, live(1, 2, 3, 4)).teams;
const snapshot = () => JSON.stringify(base);
const shape = (teams: ResolvedTeam[]) => teams.map((t) => [t.label, t.members.map((m) => m.codeIndex)]);

describe("teamsFromDirectory", () => {
  it("hands each member their stored key, so no code is needed", () => {
    const { teams, missingKey } = teamsFromDirectory(directory, live(1, 2, 3, 4));
    expect(shape(teams)).toEqual([
      ["Team 1", [1, 2]],
      ["Team 2", [3, 4]],
    ]);
    expect(teams[0].members[0].memberKeyRaw).toEqual(key(1));
    expect(teams[0].members[0].code).toBeUndefined();
    expect(missingKey).toEqual([]);
  });

  it("drops students who have since been removed from the session", () => {
    // Their document is gone; a batch that tries to update it fails whole.
    const { teams } = teamsFromDirectory(directory, live(1, 3, 4));
    expect(shape(teams)).toEqual([
      ["Team 1", [1]],
      ["Team 2", [3, 4]],
    ]);
  });

  it("reports a live member whose key the directory does not hold", () => {
    const old = { ...directory, memberKeys: { ...directory.memberKeys } };
    delete old.memberKeys.hash3;
    const { teams, missingKey } = teamsFromDirectory(old, live(1, 2, 3, 4));
    expect(missingKey).toEqual([{ codeIndex: 3, label: "Team 2" }]);
    expect(shape(teams)[1]).toEqual(["Team 2", [4]]);
  });

  it("keeps an emptied team in the list", () => {
    const { teams } = teamsFromDirectory(directory, live(1, 2));
    expect(shape(teams)).toEqual([
      ["Team 1", [1, 2]],
      ["Team 2", []],
    ]);
  });
});

describe("unassignedStudents", () => {
  it("lists live students no team places, in index order", () => {
    expect(unassignedStudents(directory, live(9, 2, 7, 1))).toEqual(live(7, 9));
  });
});

describe("labels", () => {
  it("normalizes whitespace and compares case-insensitively", () => {
    expect(normalizeLabel("  Team   3 ")).toBe("Team 3");
    expect(labelKey("TEAM 3")).toBe(labelKey(" team 3"));
    expect(findTeam(base, " team 2")?.label).toBe("Team 2");
    expect(findTeam(base, "Team 9")).toBeUndefined();
  });
});

describe("applyTeamEdit", () => {
  it("never mutates its input", () => {
    const before = snapshot();
    applyTeamEdit(base, { type: "move", codeHash: "hash3", toLabel: "Team 1" });
    applyTeamEdit(base, { type: "remove", codeHash: "hash1" });
    applyTeamEdit(base, { type: "add", member: { codeIndex: 5, codeHash: "hash5", code: "X" }, toLabel: "Team 9" });
    applyTeamEdit(base, { type: "sync" });
    expect(snapshot()).toBe(before);
  });

  it("sync is a deep-equal copy", () => {
    const out = applyTeamEdit(base, { type: "sync" });
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
  });

  describe("move", () => {
    it("takes the member from one team and appends them to the other", () => {
      const out = applyTeamEdit(base, { type: "move", codeHash: "hash3", toLabel: "Team 1" });
      expect(shape(out)).toEqual([
        ["Team 1", [1, 2, 3]],
        ["Team 2", [4]],
      ]);
      // The key travels with them.
      expect(out[0].members[2].memberKeyRaw).toEqual(key(3));
    });

    it("creates a team for a label that does not exist yet", () => {
      const out = applyTeamEdit(base, { type: "move", codeHash: "hash3", toLabel: "  Team 7 " });
      expect(shape(out)).toEqual([
        ["Team 1", [1, 2]],
        ["Team 2", [4]],
        ["Team 7", [3]],
      ]);
    });

    it("joins an existing team whose label differs only in case or spacing", () => {
      // Otherwise "team 1" would quietly become a second team beside "Team 1".
      const out = applyTeamEdit(base, { type: "move", codeHash: "hash3", toLabel: "team  1" });
      expect(shape(out)).toEqual([
        ["Team 1", [1, 2, 3]],
        ["Team 2", [4]],
      ]);
    });

    it("leaves an emptied source team in place", () => {
      const one = applyTeamEdit(base, { type: "move", codeHash: "hash3", toLabel: "Team 1" });
      const two = applyTeamEdit(one, { type: "move", codeHash: "hash4", toLabel: "Team 1" });
      expect(shape(two)).toEqual([
        ["Team 1", [1, 2, 3, 4]],
        ["Team 2", []],
      ]);
    });

    it("is a no-op when the target is the team they are already on", () => {
      expect(applyTeamEdit(base, { type: "move", codeHash: "hash3", toLabel: "team 2" })).toEqual(base);
    });

    it("refuses an unknown student and an empty label", () => {
      expect(() => applyTeamEdit(base, { type: "move", codeHash: "nobody", toLabel: "Team 1" })).toThrow(/not on any team/);
      expect(() => applyTeamEdit(base, { type: "move", codeHash: "hash3", toLabel: "   " })).toThrow(/name/);
    });
  });

  describe("remove", () => {
    it("drops the member and keeps the team, even when it empties", () => {
      const out = applyTeamEdit(applyTeamEdit(base, { type: "remove", codeHash: "hash3" }), {
        type: "remove",
        codeHash: "hash4",
      });
      expect(shape(out)).toEqual([
        ["Team 1", [1, 2]],
        ["Team 2", []],
      ]);
    });

    it("refuses an unknown student", () => {
      expect(() => applyTeamEdit(base, { type: "remove", codeHash: "nobody" })).toThrow();
    });
  });

  describe("add", () => {
    const newcomer = { codeIndex: 5, codeHash: "hash5", code: "CODE0-00005" };

    it("places the newcomer on a named or a new team", () => {
      expect(shape(applyTeamEdit(base, { type: "add", member: newcomer, toLabel: "Team 2" }))).toEqual([
        ["Team 1", [1, 2]],
        ["Team 2", [3, 4, 5]],
      ]);
      expect(shape(applyTeamEdit(base, { type: "add", member: newcomer, toLabel: "Team 3" }))).toEqual([
        ["Team 1", [1, 2]],
        ["Team 2", [3, 4]],
        ["Team 3", [5]],
      ]);
    });

    it("does not depend on the newcomer being in the live snapshot", () => {
      // The doc was just written; the listener may not have caught up. The
      // directory-derived members are filtered by liveness, the addition is not.
      const stale = teamsFromDirectory(directory, live(1, 2, 3, 4)).teams;
      const out = applyTeamEdit(stale, { type: "add", member: newcomer, toLabel: "Team 1" });
      expect(shape(out)[0]).toEqual(["Team 1", [1, 2, 5]]);
    });

    it("refuses a student who is already on a team", () => {
      expect(() =>
        applyTeamEdit(base, { type: "add", member: { codeIndex: 3, codeHash: "hash3", code: "X" }, toLabel: "Team 1" }),
      ).toThrow(/already on a team/);
    });
  });

  describe("deleteTeam", () => {
    it("removes only a team with no members", () => {
      const emptied = teamsFromDirectory(directory, live(1, 2)).teams;
      expect(shape(applyTeamEdit(emptied, { type: "deleteTeam", label: "team 2" }))).toEqual([["Team 1", [1, 2]]]);
      expect(() => applyTeamEdit(base, { type: "deleteTeam", label: "Team 2" })).toThrow(/no members/);
      expect(() => applyTeamEdit(base, { type: "deleteTeam", label: "Team 9" })).toThrow(/No such team/);
    });
  });
});

describe("movedMembers", () => {
  it("names students who are on a different team than the directory says", () => {
    const next = applyTeamEdit(base, { type: "move", codeHash: "hash3", toLabel: "Team 1" });
    expect(movedMembers(directory, next)).toEqual([
      { codeIndex: 3, codeHash: "hash3", fromLabel: "Team 2", fromToken: "tokB", toLabel: "Team 1" },
    ]);
  });

  it("ignores students who left and students who stayed", () => {
    const next = applyTeamEdit(base, { type: "remove", codeHash: "hash3" });
    expect(movedMembers(directory, next)).toEqual([]);
  });
});

describe("teamEditWarnings", () => {
  const ctx = (over: Partial<TeamEditContext> = {}): TeamEditContext => ({
    teams: base,
    sessionStatus: "closed",
    rounds: { formative: { status: "pending" }, summative: { status: "pending" } },
    contractStatus: new Map(),
    ...over,
  });

  it("always tells a mover about the display name and the old team key", () => {
    expect(teamEditWarnings({ type: "move", codeHash: "hash3", toLabel: "Team 1" }, ctx())).toEqual([
      "nicknameReset",
      "teamKeyRetained",
    ]);
  });

  it("withdraws an open-round ballot and excludes a closed-round one", () => {
    const moving = { type: "move" as const, codeHash: "hash3", toLabel: "Team 1" };
    expect(
      teamEditWarnings(
        moving,
        ctx({ rounds: { formative: { status: "open" }, summative: { status: "pending" } }, submitted: { formative: true } }),
      ),
    ).toEqual(["ballotWithdrawn", "roundOpen", "nicknameReset", "teamKeyRetained"]);
    expect(
      teamEditWarnings(
        moving,
        ctx({ rounds: { formative: { status: "closed" }, summative: { status: "pending" } }, submitted: { formative: true } }),
      ),
    ).toEqual(["ballotExcluded", "nicknameReset", "teamKeyRetained"]);
    // Results already out: nothing left to exclude.
    expect(
      teamEditWarnings(
        moving,
        ctx({
          rounds: { formative: { status: "closed", resultsPublished: true }, summative: { status: "pending" } },
          submitted: { formative: true },
        }),
      ),
    ).toEqual(["nicknameReset", "teamKeyRetained"]);
    // An open round with nothing submitted is only the general caution.
    expect(
      teamEditWarnings(moving, ctx({ rounds: { formative: { status: "open" }, summative: { status: "pending" } } })),
    ).toEqual(["roundOpen", "nicknameReset", "teamKeyRetained"]);
  });

  it("flags a finalized contract, an emptied team and a new team", () => {
    const solo = teamsFromDirectory(directory, live(1, 2, 3)).teams; // Team 2 = [3]
    expect(
      teamEditWarnings(
        { type: "move", codeHash: "hash3", toLabel: "Team 9" },
        ctx({ teams: solo, contractStatus: new Map([["Team 2", "final"]]) }),
      ),
    ).toEqual(["contractFinalized", "teamLeftEmpty", "newTeam", "nicknameReset", "teamKeyRetained"]);
    expect(teamEditWarnings({ type: "remove", codeHash: "hash3" }, ctx({ teams: solo }))).toEqual(["teamLeftEmpty"]);
  });

  it("tells an adder about the closed survey, and nothing else on a quiet session", () => {
    const add = { type: "add" as const, member: { codeIndex: 5, codeHash: "hash5" }, toLabel: "Team 1" };
    expect(teamEditWarnings(add, ctx())).toEqual(["surveyClosed"]);
    expect(teamEditWarnings(add, ctx({ sessionStatus: "open" }))).toEqual([]);
    expect(
      teamEditWarnings({ ...add, toLabel: "Team 8" }, ctx({ rounds: { formative: { status: "open" }, summative: { status: "pending" } } })),
    ).toEqual(["roundOpen", "newTeam", "surveyClosed"]);
  });
});
