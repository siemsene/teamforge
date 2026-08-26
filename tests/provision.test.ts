import { describe, expect, it } from "vitest";
import { buildProvisioning, type ResolvedTeam } from "../src/features/teams/provision";
import { hashTeamToken } from "../src/lib/memberKey";
import { eciesDecrypt, generateSessionKeys, unlockWithPassphrase } from "../src/lib/crypto";
import type { TeamDirectory } from "../src/types";

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
});
