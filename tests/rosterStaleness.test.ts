import { describe, expect, it } from "vitest";
import { allocationDrift, rosterStaleness } from "../src/features/sessions/rosterStaleness";

const provisioned = (at: number | null) =>
  ({ teamMgmt: { rosterUploadedAt: at } }) as Parameters<typeof rosterStaleness>[0];

describe("rosterStaleness", () => {
  it("reports nothing on a session that predates roster editing", () => {
    expect(rosterStaleness({}, 1000)).toEqual({ allocationStale: false, teamRosterStale: false });
  });

  it("flags an allocation saved before the roster changed", () => {
    expect(rosterStaleness({ rosterChangedAt: 2000 }, 1000).allocationStale).toBe(true);
  });

  it("does not flag an allocation saved after the roster changed", () => {
    expect(rosterStaleness({ rosterChangedAt: 1000 }, 2000).allocationStale).toBe(false);
  });

  it("treats an identical timestamp as in step", () => {
    expect(rosterStaleness({ rosterChangedAt: 1000 }, 1000).allocationStale).toBe(false);
  });

  it("says nothing about an allocation that does not exist", () => {
    expect(rosterStaleness({ rosterChangedAt: 9999 }, null).allocationStale).toBe(false);
  });

  it("flags teams provisioned before the roster changed", () => {
    expect(rosterStaleness({ ...provisioned(1000), rosterChangedAt: 2000 }, null).teamRosterStale).toBe(
      true,
    );
  });

  it("says nothing about teams that were never provisioned", () => {
    expect(rosterStaleness({ ...provisioned(null), rosterChangedAt: 2000 }, null).teamRosterStale).toBe(
      false,
    );
  });
});

describe("allocationDrift", () => {
  const s = (codeIndex: number, hash: string) => ({ codeIndex, hash });

  it("finds nothing when the roster and the allocation agree", () => {
    const students = [s(1, "a"), s(2, "b")];
    expect(allocationDrift(students, { "team-1": ["a", "b"] })).toEqual({
      unassignedCodeIndexes: [],
      ghostHashes: [],
    });
  });

  it("reports a student added since the allocation was solved", () => {
    const students = [s(1, "a"), s(2, "b"), s(3, "c")];
    expect(allocationDrift(students, { "team-1": ["a", "b"] }).unassignedCodeIndexes).toEqual([3]);
  });

  it("reports a hash the allocation still places for a student who is gone", () => {
    const students = [s(1, "a")];
    expect(allocationDrift(students, { "team-1": ["a", "b"] }).ghostHashes).toEqual(["b"]);
  });

  it("reports drift in both directions at once", () => {
    const students = [s(1, "a"), s(9, "z")];
    const drift = allocationDrift(students, { "team-1": ["a", "b"], "team-2": ["c"] });
    expect(drift.unassignedCodeIndexes).toEqual([9]);
    expect(drift.ghostHashes).toEqual(["b", "c"]);
  });

  it("does not care about member order within a team", () => {
    const students = [s(1, "a"), s(2, "b")];
    const one = allocationDrift(students, { t: ["a", "b"] });
    const two = allocationDrift(students, { t: ["b", "a"] });
    expect(one).toEqual(two);
  });
});
