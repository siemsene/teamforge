// End-to-end check of the student-chosen display name, against the Firestore
// emulator: a student seals a nickname under the team key and writes it, a
// teammate reads it back, and the instructor resolves it from the directory.
// Needs the emulator, so it is skipped unless run via:  npm run test:rules
//
// Uses its own projectId: vitest runs test files in parallel, and both this and
// rules.test.ts call clearFirestore() — sharing a project makes them flaky.

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { deriveTeamKey, generateTeamToken, hashTeamToken } from "../src/lib/memberKey";
import { displayName, openNicknames, sealNickname } from "../src/lib/nicknames";
import type { AesEnvelope, TeamDoc } from "../src/types";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const rules = readFileSync("firestore.rules", "utf8");

const EMPTY_CONTRACT = {
  status: "empty",
  updatedAt: null,
  updatedByCodeIndex: null,
  content: null,
  contentForInstructor: null,
  feedback: null,
  feedbackAt: null,
  finalizedAt: null,
};

describe.skipIf(!emulatorHost)("nickname flow", () => {
  let env: RulesTestEnvironment;
  const sid = "s1";
  let token: string;
  let tokenHash: string;

  beforeAll(async () => {
    const [host, port] = emulatorHost!.split(":");
    env = await initializeTestEnvironment({
      projectId: "demo-teamforge-nicknames",
      firestore: { rules, host, port: Number(port) },
    });
  });

  afterAll(async () => env?.cleanup());

  beforeEach(async () => {
    await env.clearFirestore();
    token = generateTeamToken();
    tokenHash = await hashTeamToken(token);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, `sessions/${sid}`), {
        ownerUid: "owner1",
        status: "closed",
        title: "T",
        teamMgmt: {
          enabled: true,
          rosterUploadedAt: 1,
          factorFloor: 0.8,
          factorCeiling: 1.1,
          includeBehaviors: true,
          behaviors: ["a", "b", "c", "d"],
          aiFeedbackEnabled: true,
          rounds: { formative: { status: "open" }, summative: { status: "pending" } },
        },
      });
      await setDoc(doc(db, `sessions/${sid}/teams/${tokenHash}`), {
        teamLabel: "Team 1",
        createdAt: 1,
        contract: EMPTY_CONTRACT,
        nicknames: {},
      });
    });
  });

  it("a student's sealed nickname round-trips through Firestore for a teammate", async () => {
    const student = env.authenticatedContext("anon-a").firestore();

    // Student #3 chooses a name; it is sealed in their browser under the team key.
    const teamKey = await deriveTeamKey(sid, token);
    const sealed = await sealNickname(teamKey, "  Ana   Ng  ");
    await assertSucceeds(
      updateDoc(doc(student, `sessions/${sid}/teams/${tokenHash}`), { "nicknames.3": sealed }),
    );

    // What actually landed in the database is ciphertext, not the name.
    const raw = JSON.stringify((await getDoc(doc(student, `sessions/${sid}/teams/${tokenHash}`))).data());
    expect(raw).not.toContain("Ana");

    // A teammate derives the same team key from the token in their own roster
    // blob and reads the name back, normalized.
    const teammate = env.authenticatedContext("anon-b").firestore();
    const teamDoc = (await getDoc(doc(teammate, `sessions/${sid}/teams/${tokenHash}`))).data() as TeamDoc;
    const teammateKey = await deriveTeamKey(sid, token);
    const names = await openNicknames(teammateKey, teamDoc.nicknames);
    expect(names["3"]).toBe("Ana Ng");
    expect(displayName(3, names)).toBe("Ana Ng");
    // A member who hasn't chosen yet falls back to their code index.
    expect(displayName(4, names)).toBe("#4");
  });

  it("a wrong team key cannot read a nickname, and garbage entries degrade gracefully", async () => {
    const student = env.authenticatedContext("anon-a").firestore();
    const teamKey = await deriveTeamKey(sid, token);
    await updateDoc(doc(student, `sessions/${sid}/teams/${tokenHash}`), {
      "nicknames.3": await sealNickname(teamKey, "Ana Ng"),
    });

    // Someone holding a different team's token gets nothing readable.
    const otherKey = await deriveTeamKey(sid, generateTeamToken());
    const teamDoc = (await getDoc(doc(student, `sessions/${sid}/teams/${tokenHash}`))).data() as TeamDoc;
    expect(await openNicknames(otherKey, teamDoc.nicknames)).toEqual({});

    // A member who writes a non-envelope value only breaks their own entry.
    await updateDoc(doc(student, `sessions/${sid}/teams/${tokenHash}`), {
      "nicknames.4": { iv: "not-base64", ciphertext: "garbage" } as AesEnvelope,
    });
    const withGarbage = (await getDoc(doc(student, `sessions/${sid}/teams/${tokenHash}`))).data() as TeamDoc;
    const names = await openNicknames(teamKey, withGarbage.nicknames);
    expect(names["3"]).toBe("Ana Ng");
    expect(displayName(4, names)).toBe("#4");
  });

  it("the instructor resolves names from the directory's team token", async () => {
    const student = env.authenticatedContext("anon-a").firestore();
    const teamKey = await deriveTeamKey(sid, token);
    await updateDoc(doc(student, `sessions/${sid}/teams/${tokenHash}`), {
      "nicknames.3": await sealNickname(teamKey, "Ana Ng"),
    });

    // The instructor holds { token } per team in the encrypted directory.
    const owner = env.authenticatedContext("owner1").firestore();
    const { openDirectoryNicknames } = await import("../src/lib/nicknames");
    const resolved = await openDirectoryNicknames(sid, [{ token }], async (hash) => {
      const snap = await getDoc(doc(owner, `sessions/${sid}/teams/${hash}`));
      return snap.exists() ? (snap.data() as TeamDoc) : null;
    });
    expect(resolved["3"]).toBe("Ana Ng");
  });

  it("a nickname write is rejected once team management is turned off", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `sessions/${sid}`), { "teamMgmt.enabled": false });
    });
    const student = env.authenticatedContext("anon-a").firestore();
    const teamKey = await deriveTeamKey(sid, token);
    await assertFails(
      updateDoc(doc(student, `sessions/${sid}/teams/${tokenHash}`), {
        "nicknames.3": await sealNickname(teamKey, "Ana Ng"),
      }),
    );
  });
});
