import { describe, expect, it } from "vitest";
import { buildProvisioning, type ResolvedTeam } from "../src/features/teams/provision";
import { applyTeamEdit, teamsFromDirectory } from "../src/features/teams/teamEdit";
import { deriveMemberKey, deriveMemberKeyRaw, hashTeamToken, openEnvelope } from "../src/lib/memberKey";
import { eciesDecrypt, generateSessionKeys, toBase64, unlockWithPassphrase } from "../src/lib/crypto";
import type { RosterInfo, TeamDirectory } from "../src/types";

const SID = "sess123";

function member(codeIndex: number): { codeIndex: number; codeHash: string; code: string } {
  return { codeIndex, codeHash: `hash${codeIndex}`, code: `CODE0-000${codeIndex}` };
}

const teamsV1: ResolvedTeam[] = [
  { label: "Team 1", members: [member(1), member(2)] },
  { label: "Team 2", members: [member(3), member(4)] },
];

async function keys() {
  const { wrappedKeys } = await generateSessionKeys("a-long-enough-passphrase");
  const privateKey = await unlockWithPassphrase(wrappedKeys, "a-long-enough-passphrase");
  return { publicKeyJwk: wrappedKeys.publicKeyJwk, privateKey };
}

async function readDirectory(privateKey: CryptoKey, payload: Parameters<typeof eciesDecrypt>[1]) {
  return JSON.parse(await eciesDecrypt(privateKey, payload)) as TeamDirectory;
}

describe("buildProvisioning", () => {
  it("mints a fresh token per team on a first run", async () => {
    const { publicKeyJwk, privateKey } = await keys();
    const built = await buildProvisioning(SID, publicKeyJwk, teamsV1);
    const dir = await readDirectory(privateKey, built.directoryPayload);

    expect(dir.teams.map((t) => t.label)).toEqual(["Team 1", "Team 2"]);
    expect(new Set(dir.teams.map((t) => t.token)).size).toBe(2);
    expect(built.teamDocs.every((d) => d.reused === false)).toBe(true);
    expect(built.staleTokenHashes).toEqual([]);
  });

  it("keeps each unchanged team's token when re-provisioning", async () => {
    // The token hashes to the team's document id, and that document holds the
    // contract and every member's chosen display name. Minting a new one used to
    // orphan all of it — silently, and with no way to get it back.
    const { publicKeyJwk, privateKey } = await keys();
    const first = await readDirectory(
      privateKey,
      (await buildProvisioning(SID, publicKeyJwk, teamsV1)).directoryPayload,
    );

    // A student moves from Team 2 to Team 1; both labels survive.
    const teamsV2: ResolvedTeam[] = [
      { label: "Team 1", members: [member(1), member(2), member(3)] },
      { label: "Team 2", members: [member(4)] },
    ];
    const second = await buildProvisioning(SID, publicKeyJwk, teamsV2, undefined, first);
    const dir2 = await readDirectory(privateKey, second.directoryPayload);

    for (const label of ["Team 1", "Team 2"]) {
      const before = first.teams.find((t) => t.label === label)!.token;
      const after = dir2.teams.find((t) => t.label === label)!.token;
      expect(after).toBe(before);
    }
    expect(second.teamDocs.every((d) => d.reused)).toBe(true);
    expect(second.staleTokenHashes).toEqual([]);
  });

  it("reports teams that have disappeared, so their docs can be removed", async () => {
    const { publicKeyJwk, privateKey } = await keys();
    const first = await readDirectory(
      privateKey,
      (await buildProvisioning(SID, publicKeyJwk, teamsV1)).directoryPayload,
    );

    const merged: ResolvedTeam[] = [{ label: "Team 1", members: [member(1), member(2), member(3), member(4)] }];
    const second = await buildProvisioning(SID, publicKeyJwk, merged, undefined, first);

    const goneToken = first.teams.find((t) => t.label === "Team 2")!.token;
    expect(second.staleTokenHashes).toEqual([await hashTeamToken(goneToken)]);
    // ...and the surviving team is left alone rather than rewritten.
    expect(second.teamDocs).toHaveLength(1);
    expect(second.teamDocs[0].reused).toBe(true);
  });

  it("gives a genuinely new team a new token while reusing the rest", async () => {
    const { publicKeyJwk, privateKey } = await keys();
    const first = await readDirectory(
      privateKey,
      (await buildProvisioning(SID, publicKeyJwk, teamsV1)).directoryPayload,
    );

    const grown: ResolvedTeam[] = [...teamsV1, { label: "Team 3", members: [member(5)] }];
    const second = await buildProvisioning(SID, publicKeyJwk, grown, undefined, first);
    const dir2 = await readDirectory(privateKey, second.directoryPayload);

    const newToken = dir2.teams.find((t) => t.label === "Team 3")!.token;
    expect(first.teams.map((t) => t.token)).not.toContain(newToken);
    expect(second.teamDocs.filter((d) => d.reused)).toHaveLength(2);
    expect(second.teamDocs.filter((d) => !d.reused)).toHaveLength(1);
    expect(second.staleTokenHashes).toEqual([]);
  });

  it("re-seals every member's roster blob, so a moved student sees the change", async () => {
    const { publicKeyJwk, privateKey } = await keys();
    const first = await readDirectory(
      privateKey,
      (await buildProvisioning(SID, publicKeyJwk, teamsV1)).directoryPayload,
    );
    const teamsV2: ResolvedTeam[] = [
      { label: "Team 1", members: [member(1), member(2), member(3)] },
      { label: "Team 2", members: [member(4)] },
    ];
    const second = await buildProvisioning(SID, publicKeyJwk, teamsV2, undefined, first);
    expect(second.studentPatches.map((p) => p.hash).sort()).toEqual(["hash1", "hash2", "hash3", "hash4"]);
  });

  it("seals with a supplied raw key exactly as it would from the code", async () => {
    // This is what lets the Teams tab change a team without the codes CSV: the
    // directory holds each member's raw key, and a blob sealed from it must
    // open with the key the student derives from their own code at login.
    const { publicKeyJwk, privateKey } = await keys();
    const code = "CODE0-00003";
    const raw = await deriveMemberKeyRaw(SID, code);
    const teams: ResolvedTeam[] = [{ label: "Team 1", members: [{ codeIndex: 3, codeHash: "hash3", memberKeyRaw: raw }] }];
    const built = await buildProvisioning(SID, publicKeyJwk, teams);

    const opened = JSON.parse(await openEnvelope(await deriveMemberKey(SID, code), built.studentPatches[0].roster)) as RosterInfo;
    expect(opened.codeIndex).toBe(3);
    expect(opened.teamLabel).toBe("Team 1");
    expect(opened.teammates).toEqual([]);
    const dir = await readDirectory(privateKey, built.directoryPayload);
    expect(dir.memberKeys.hash3).toBe(toBase64(raw));
    expect(built.directory).toEqual(dir);
  });

  it("round-trips: directory -> teamsFromDirectory -> rebuild keeps tokens and keys", async () => {
    const { publicKeyJwk, privateKey } = await keys();
    const first = await readDirectory(privateKey, (await buildProvisioning(SID, publicKeyJwk, teamsV1)).directoryPayload);
    const live = [1, 2, 3, 4].map((codeIndex) => ({ codeIndex, hash: `hash${codeIndex}` }));
    const { teams, missingKey } = teamsFromDirectory(first, live);
    expect(missingKey).toEqual([]);

    const second = await buildProvisioning(SID, publicKeyJwk, teams, undefined, first);
    expect(second.directory.teams.map((t) => [t.label, t.token])).toEqual(first.teams.map((t) => [t.label, t.token]));
    expect(second.directory.memberKeys).toEqual(first.memberKeys);
    expect(second.teamDocs.every((d) => d.reused)).toBe(true);
  });

  it("records who moved off a team, and forgets them when they come back", async () => {
    // A ballot a teammate submitted while #3 was on Team 2 allocates points to
    // #3. Validation must still accept it, and #3 is neither a current member
    // nor a retired index — so the directory remembers.
    const { publicKeyJwk } = await keys();
    const first = (await buildProvisioning(SID, publicKeyJwk, teamsV1)).directory;
    const live = [1, 2, 3, 4].map((codeIndex) => ({ codeIndex, hash: `hash${codeIndex}` }));

    const moved = applyTeamEdit(teamsFromDirectory(first, live).teams, { type: "move", codeHash: "hash3", toLabel: "Team 1" });
    const second = (await buildProvisioning(SID, publicKeyJwk, moved, undefined, first)).directory;
    expect(second.teams.find((t) => t.label === "Team 2")!.formerCodeIndexes).toEqual([3]);
    expect(second.teams.find((t) => t.label === "Team 1")!.formerCodeIndexes).toBeUndefined();

    // A later rebuild with no change keeps the record.
    const third = (await buildProvisioning(SID, publicKeyJwk, teamsFromDirectory(second, live).teams, undefined, second)).directory;
    expect(third.teams.find((t) => t.label === "Team 2")!.formerCodeIndexes).toEqual([3]);

    // Moving back makes them a member again, not a former one.
    const back = applyTeamEdit(teamsFromDirectory(third, live).teams, { type: "move", codeHash: "hash3", toLabel: "Team 2" });
    const fourth = (await buildProvisioning(SID, publicKeyJwk, back, undefined, third)).directory;
    expect(fourth.teams.find((t) => t.label === "Team 2")!.formerCodeIndexes).toBeUndefined();
    // ...and Team 1 now remembers them instead.
    expect(fourth.teams.find((t) => t.label === "Team 1")!.formerCodeIndexes).toEqual([3]);
  });

  it("does not count a student who left the session as a former member", async () => {
    const { publicKeyJwk } = await keys();
    const first = (await buildProvisioning(SID, publicKeyJwk, teamsV1)).directory;
    const live = [1, 2, 4].map((codeIndex) => ({ codeIndex, hash: `hash${codeIndex}` })); // #3 removed
    const second = (await buildProvisioning(SID, publicKeyJwk, teamsFromDirectory(first, live).teams, undefined, first)).directory;
    expect(second.teams.find((t) => t.label === "Team 2")!.formerCodeIndexes).toBeUndefined();
  });

  it("keeps an emptied team's token rather than reporting it stale", async () => {
    const { publicKeyJwk } = await keys();
    const first = (await buildProvisioning(SID, publicKeyJwk, teamsV1)).directory;
    const emptied: ResolvedTeam[] = [
      { label: "Team 1", members: [member(1), member(2), member(3), member(4)] },
      { label: "Team 2", members: [] },
    ];
    const second = await buildProvisioning(SID, publicKeyJwk, emptied, undefined, first);
    expect(second.staleTokenHashes).toEqual([]);
    expect(second.teamDocs.map((d) => d.reused)).toEqual([true, true]);
    expect(second.directory.teams.find((t) => t.label === "Team 2")!.token).toBe(first.teams[1].token);
  });

  it("refuses a member with neither a code nor a key", async () => {
    const { publicKeyJwk } = await keys();
    await expect(
      buildProvisioning(SID, publicKeyJwk, [{ label: "Team 1", members: [{ codeIndex: 9, codeHash: "hash9" }] }]),
    ).rejects.toThrow(/#9/);
  });
});
