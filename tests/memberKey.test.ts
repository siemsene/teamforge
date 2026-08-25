import { describe, expect, it } from "vitest";
import {
  deriveMemberKey,
  deriveMemberKeyRaw,
  deriveTeamKey,
  generateTeamToken,
  hashTeamToken,
  importMemberKey,
  openEnvelope,
  sealEnvelope,
} from "../src/lib/memberKey";
import { hashCode } from "../src/lib/codes";
import { toBase64 } from "../src/lib/crypto";

describe("member key", () => {
  it("derives deterministically from the same session and code", async () => {
    const a = await deriveMemberKeyRaw("session1", "ABCDE-FGHJK");
    const b = await deriveMemberKeyRaw("session1", "abcde fghjk"); // normalization-tolerant
    expect(toBase64(a)).toBe(toBase64(b));
  });

  it("differs across sessions and across codes", async () => {
    const a = await deriveMemberKeyRaw("session1", "ABCDE-FGHJK");
    const b = await deriveMemberKeyRaw("session2", "ABCDE-FGHJK");
    const c = await deriveMemberKeyRaw("session1", "ABCDE-FGHJM");
    expect(toBase64(a)).not.toBe(toBase64(b));
    expect(toBase64(a)).not.toBe(toBase64(c));
  });

  it("is domain-separated from the stored login-code hash", async () => {
    const raw = await deriveMemberKeyRaw("session1", "ABCDE-FGHJK");
    const hash = await hashCode("ABCDE-FGHJK");
    const rawHex = [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(rawHex).not.toBe(hash);
  });

  it("round-trips an envelope and rejects tampering", async () => {
    const key = await deriveMemberKey("session1", "ABCDE-FGHJK");
    const env = await sealEnvelope(key, JSON.stringify({ name: "Ana", teamLabel: "Team 1" }));
    expect(env.ciphertext).not.toContain("Ana");
    expect(JSON.parse(await openEnvelope(key, env))).toEqual({ name: "Ana", teamLabel: "Team 1" });

    const tampered = { ...env, ciphertext: env.ciphertext.slice(0, -4) + "AAAA" };
    await expect(openEnvelope(key, tampered)).rejects.toThrow();

    const wrongKey = await deriveMemberKey("session1", "ABCDE-FGHJM");
    await expect(openEnvelope(wrongKey, env)).rejects.toThrow();
  });

  it("re-imports the raw key for result publishing", async () => {
    const raw = await deriveMemberKeyRaw("session1", "ABCDE-FGHJK");
    const original = await deriveMemberKey("session1", "ABCDE-FGHJK");
    const reimported = await importMemberKey(raw);
    const env = await sealEnvelope(reimported, "published result");
    expect(await openEnvelope(original, env)).toBe("published result");
  });
});

describe("team token & key", () => {
  it("generates 26-char unambiguous tokens", () => {
    const token = generateTeamToken();
    expect(token).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
    expect(generateTeamToken()).not.toBe(token);
  });

  it("hashes tokens to hex doc ids", async () => {
    const token = generateTeamToken();
    const hash = await hashTeamToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashTeamToken(token)).toBe(hash);
  });

  it("round-trips a contract under the team key; key is session-scoped", async () => {
    const token = generateTeamToken();
    const key = await deriveTeamKey("session1", token);
    const env = await sealEnvelope(key, "contract text");
    expect(await openEnvelope(key, env)).toBe("contract text");

    const otherSession = await deriveTeamKey("session2", token);
    await expect(openEnvelope(otherSession, env)).rejects.toThrow();
  });
});
