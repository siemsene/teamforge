import { describe, expect, it } from "vitest";
import {
  hashRows,
  joinAllocationTeams,
  membershipFromAllocation,
  teamLabels,
  type HashedRow,
  type Membership,
} from "../src/features/teams/allocationTeams";
import { hashCode } from "../src/lib/codes";
import type { Allocation } from "../src/types";

const row = (over: Partial<HashedRow["row"]> = {}) => ({
  code: "",
  index: null,
  name: "",
  team: "",
  ...over,
});

const empty: Membership = { byHash: new Map(), problems: [] };

describe("teamLabels", () => {
  it("mirrors the generic team ids the solver is given", () => {
    // Must match AllocationTab: `team-K`, since those are the keys the saved
    // allocation is written with.
    const labels = teamLabels({ genericProjects: true, numTeams: 3 }, []);
    expect([...labels]).toEqual([
      ["team-1", "Team 1"],
      ["team-2", "Team 2"],
      ["team-3", "Team 3"],
    ]);
  });

  it("uses project names when the session has real projects", () => {
    const labels = teamLabels({ genericProjects: false, numTeams: 2 }, [
      { id: "p1", name: "Riverside Museum" },
      { id: "p2", name: "Transit App" },
    ]);
    expect(labels.get("p1")).toBe("Riverside Museum");
    expect(labels.get("p2")).toBe("Transit App");
  });
});

describe("membershipFromAllocation", () => {
  const alloc: Allocation = {
    teams: { "team-1": ["h1", "h2"], "team-2": ["h3"] },
    objective: 0,
    solvedAt: 0,
  };

  it("flattens the allocation to codeHash -> label", () => {
    const m = membershipFromAllocation(alloc, teamLabels({ genericProjects: true, numTeams: 2 }, []));
    expect([...m.byHash]).toEqual([
      ["h1", "Team 1"],
      ["h2", "Team 1"],
      ["h3", "Team 2"],
    ]);
    expect(m.problems).toEqual([]);
  });

  it("keeps students whose project has since been deleted, and says so", () => {
    const m = membershipFromAllocation(alloc, new Map([["team-1", "Team 1"]]));
    expect(m.byHash.get("h3")).toBe("team-2"); // falls back to the id
    expect(m.problems.join(" ")).toMatch(/no longer matches a project/);
  });
});

describe("hashRows", () => {
  const students = [
    { hash: "hash-of-1", codeIndex: 1 },
    { hash: "hash-of-2", codeIndex: 2 },
  ];

  it("hashes the login code when the file supplies one", async () => {
    const [r] = await hashRows([row({ code: "ABCDE-12345" })], students);
    expect(r.codeHash).toBe(await hashCode("ABCDE-12345"));
  });

  it("falls back to the code index", async () => {
    const [r] = await hashRows([row({ index: 2 })], students);
    expect(r.codeHash).toBe("hash-of-2");
  });

  it("returns null for a student who is not in this session", async () => {
    const [r] = await hashRows([row({ index: 99 })], students);
    expect(r.codeHash).toBeNull();
  });
});

describe("joinAllocationTeams", () => {
  const membership: Membership = {
    byHash: new Map([
      ["h1", "Team 1"],
      ["h2", "Team 1"],
      ["h3", "Team 2"],
    ]),
    problems: [],
  };

  it("fills every team from the allocation, so nothing is re-entered", () => {
    const hashed: HashedRow[] = [
      { row: row({ index: 1 }), codeHash: "h1" },
      { row: row({ index: 2 }), codeHash: "h2" },
      { row: row({ index: 3 }), codeHash: "h3" },
    ];
    const r = joinAllocationTeams(hashed, membership);
    expect(r.rows.map((x) => x.team)).toEqual(["Team 1", "Team 1", "Team 2"]);
    expect(r.fromAllocation).toBe(3);
    expect(r.fromFile).toBe(0);
    expect(r.problems).toEqual([]);
  });

  it("lets a team column in the file override the allocation", () => {
    // The instructor moved someone after allocating. Their file wins.
    const hashed: HashedRow[] = [
      { row: row({ index: 1 }), codeHash: "h1" },
      { row: row({ index: 3, team: "Team 1" }), codeHash: "h3" }, // was Team 2
    ];
    const r = joinAllocationTeams(hashed, membership);
    expect(r.rows.map((x) => x.team)).toEqual(["Team 1", "Team 1"]);
    expect(r.fromAllocation).toBe(1);
    expect(r.fromFile).toBe(1);
  });

  it("works with no allocation at all, when the file carries teams", () => {
    const hashed: HashedRow[] = [{ row: row({ index: 1, team: "Team 9" }), codeHash: "h1" }];
    const r = joinAllocationTeams(hashed, empty);
    expect(r.rows[0].team).toBe("Team 9");
    expect(r.fromFile).toBe(1);
    expect(r.problems).toEqual([]);
  });

  it("flags a student the allocation does not cover", () => {
    const hashed: HashedRow[] = [{ row: row({ index: 7 }), codeHash: "h7" }];
    const r = joinAllocationTeams(hashed, membership);
    expect(r.rows[0].team).toBe(""); // left blank; the caller drops it
    expect(r.problems.join(" ")).toMatch(/Student #7 is not in the saved allocation/);
  });

  it("flags a file that is missing students the allocation has", () => {
    // The failure worth catching: a truncated or stale codes CSV would
    // otherwise provision half the class and look fine.
    const hashed: HashedRow[] = [{ row: row({ index: 1 }), codeHash: "h1" }];
    const r = joinAllocationTeams(hashed, membership);
    expect(r.problems.join(" ")).toMatch(/2 students in the saved allocation are not in this file/);
  });

  it("uses singular wording for a single missing student", () => {
    const hashed: HashedRow[] = [
      { row: row({ index: 1 }), codeHash: "h1" },
      { row: row({ index: 2 }), codeHash: "h2" },
    ];
    const r = joinAllocationTeams(hashed, membership);
    expect(r.problems.join(" ")).toMatch(/1 student in the saved allocation is not in this file/);
  });

  it("carries the allocation's own problems through", () => {
    const r = joinAllocationTeams([], { byHash: new Map(), problems: ["stale project"] });
    expect(r.problems).toEqual(["stale project"]);
  });

  it("describes an unmatched row by whatever identifies it", () => {
    const byCode = joinAllocationTeams(
      [{ row: row({ code: "ABCDE-12345" }), codeHash: "nope" }],
      membership,
    );
    expect(byCode.problems[0]).toMatch(/Login code ABCDE…/);

    const unidentifiable = joinAllocationTeams([{ row: row(), codeHash: null }], membership);
    expect(unidentifiable.problems[0]).toMatch(/A row in the file/);
  });
});
