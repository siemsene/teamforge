import { describe, expect, it } from "vitest";
import {
  eciesDecrypt,
  eciesEncrypt,
  generateSessionKeys,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
} from "../src/lib/crypto";

describe("session crypto", () => {
  it("round-trips a student response via passphrase unlock", async () => {
    const { wrappedKeys } = await generateSessionKeys("correct horse battery staple");
    const payload = await eciesEncrypt(wrappedKeys.publicKeyJwk, JSON.stringify({ q1: 5, q2: "Woman" }));

    expect(payload.ciphertext).not.toContain("Woman");

    const privateKey = await unlockWithPassphrase(wrappedKeys, "correct horse battery staple");
    const plaintext = await eciesDecrypt(privateKey, payload);
    expect(JSON.parse(plaintext)).toEqual({ q1: 5, q2: "Woman" });
  });

  it("round-trips via the recovery key", async () => {
    const { wrappedKeys, recoveryKeyB64 } = await generateSessionKeys("some long passphrase");
    const payload = await eciesEncrypt(wrappedKeys.publicKeyJwk, "secret survey data");

    const privateKey = await unlockWithRecoveryKey(wrappedKeys, recoveryKeyB64);
    expect(await eciesDecrypt(privateKey, payload)).toBe("secret survey data");
  });

  it("rejects a wrong passphrase", async () => {
    const { wrappedKeys } = await generateSessionKeys("the right passphrase");
    await expect(unlockWithPassphrase(wrappedKeys, "the wrong passphrase")).rejects.toThrow();
  });

  it("produces distinct ciphertexts for identical plaintexts (ephemeral keys)", async () => {
    const { wrappedKeys } = await generateSessionKeys("pass pass pass");
    const a = await eciesEncrypt(wrappedKeys.publicKeyJwk, "same");
    const b = await eciesEncrypt(wrappedKeys.publicKeyJwk, "same");
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});
