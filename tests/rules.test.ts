// Firestore security-rules tests. They need the emulator, so they are skipped
// unless run via:  npm run test:rules
// (firebase emulators:exec sets FIRESTORE_EMULATOR_HOST automatically)

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, updateDoc, writeBatch } from "firebase/firestore";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const rules = readFileSync("firestore.rules", "utf8");
const ADMIN_UID = /return\s+"([^"]+)";/.exec(rules)![1];
const VALID_PAYLOAD = {
  ephemeralPublicKeyJwk: {
    kty: "EC",
    crv: "P-256",
    key_ops: [],
    ext: true,
    x: "abc",
    y: "def",
  },
  iv: "iv",
  ciphertext: "ct",
};

describe.skipIf(!emulatorHost)("firestore security rules", () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, port] = emulatorHost!.split(":");
    env = await initializeTestEnvironment({
      projectId: "demo-teamforge",
      firestore: { rules, host, port: Number(port) },
    });
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  beforeEach(async () => {
    await env.clearFirestore();
    // Seed: an approved instructor owning a session with one student doc.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users/owner1"), { name: "Owner", email: "o@x.edu", approved: true, createdAt: 1 });
      await setDoc(doc(db, "users/newbie"), { name: "New", email: "n@x.edu", approved: false, createdAt: 1 });
      await setDoc(doc(db, "sessions/s1"), { ownerUid: "owner1", status: "open", title: "T" });
      await setDoc(doc(db, "sessions/s1/public/config"), { title: "T", status: "open" });
      await setDoc(doc(db, "sessions/s1/students/hashA"), { codeIndex: 1, submittedAt: null, response: null });
      await setDoc(doc(db, "sessions/s1/results/allocation"), { payload: VALID_PAYLOAD, updatedAt: 1 });
    });
  });

  it("unapproved instructors cannot create sessions; approved can", async () => {
    const newbie = env.authenticatedContext("newbie").firestore();
    await assertFails(setDoc(doc(newbie, "sessions/nope"), { ownerUid: "newbie", status: "draft" }));

    const owner = env.authenticatedContext("owner1").firestore();
    await assertSucceeds(setDoc(doc(owner, "sessions/ok"), { ownerUid: "owner1", status: "draft" }));
  });

  it("instructors cannot create sessions owned by someone else", async () => {
    const owner = env.authenticatedContext("owner1").firestore();
    await assertFails(setDoc(doc(owner, "sessions/spoof"), { ownerUid: "victim", status: "draft" }));
  });

  // Regression for the "Missing or insufficient permissions" bug on session
  // creation. The public/config write rule calls ownsSession(), which get()s the
  // parent session doc — and rule get()s never see sibling writes in the same
  // batch. Bundling the session doc with public/config therefore fails even for
  // an approved owner; createSession() must commit the session doc first.
  it("rejects creating the session doc and public/config in one batch", async () => {
    const owner = env.authenticatedContext("owner1").firestore();
    const batch = writeBatch(owner);
    batch.set(doc(owner, "sessions/screate"), { ownerUid: "owner1", status: "draft", title: "T" });
    batch.set(doc(owner, "sessions/screate/public/config"), { title: "T", status: "draft" });
    await assertFails(batch.commit());
  });

  it("allows the split write createSession uses: session doc first, then public/config and students", async () => {
    const owner = env.authenticatedContext("owner1").firestore();
    await assertSucceeds(setDoc(doc(owner, "sessions/screate"), { ownerUid: "owner1", status: "draft", title: "T" }));
    await assertSucceeds(setDoc(doc(owner, "sessions/screate/public/config"), { title: "T", status: "draft" }));
    const batch = writeBatch(owner);
    batch.set(doc(owner, "sessions/screate/students/h1"), { codeIndex: 1, submittedAt: null, response: null });
    batch.set(doc(owner, "sessions/screate/students/h2"), { codeIndex: 2, submittedAt: null, response: null });
    await assertSucceeds(batch.commit());
  });

  it("non-owners cannot read a session or its results", async () => {
    const other = env.authenticatedContext("other").firestore();
    await assertFails(getDoc(doc(other, "sessions/s1")));
    await assertFails(getDoc(doc(other, "sessions/s1/results/allocation")));
  });

  it("anonymous students can get their own doc but never list", async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, "sessions/s1/students/hashA")));

    const student = env.authenticatedContext("anonuser").firestore();
    await assertSucceeds(getDoc(doc(student, "sessions/s1/students/hashA")));
    await assertFails(getDocs(collection(student, "sessions/s1/students")));
  });

  it("students can submit a response while open, but cannot touch codeIndex", async () => {
    const student = env.authenticatedContext("anonuser").firestore();
    await assertSucceeds(
      updateDoc(doc(student, "sessions/s1/students/hashA"), { response: VALID_PAYLOAD, submittedAt: 5 }),
    );
    await assertFails(
      updateDoc(doc(student, "sessions/s1/students/hashA"), { response: VALID_PAYLOAD, submittedAt: 5, codeIndex: 99 }),
    );
    await assertFails(
      updateDoc(doc(student, "sessions/s1/students/hashA"), { response: "not-an-envelope", submittedAt: 5 }),
    );
    await assertFails(
      updateDoc(doc(student, "sessions/s1/students/hashA"), {
        response: { ephemeralPublicKeyJwk: { kty: "EC" }, iv: "iv", ciphertext: "ct" },
        submittedAt: 5,
      }),
    );
    await assertSucceeds(updateDoc(doc(student, "sessions/s1/students/hashA"), { response: null, submittedAt: null }));
    await assertFails(deleteDoc(doc(student, "sessions/s1/students/hashA")));
  });

  it("students cannot submit when the session is closed", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "sessions/s1"), { status: "closed" });
    });
    const student = env.authenticatedContext("anonuser").firestore();
    await assertFails(updateDoc(doc(student, "sessions/s1/students/hashA"), { response: VALID_PAYLOAD, submittedAt: 5 }));
  });

  it("anyone signed in can read the public survey config", async () => {
    const student = env.authenticatedContext("anonuser").firestore();
    await assertSucceeds(getDoc(doc(student, "sessions/s1/public/config")));
    await assertFails(setDoc(doc(student, "sessions/s1/public/config"), { hacked: true }));
  });

  it("only the admin can approve instructors", async () => {
    const self = env.authenticatedContext("newbie").firestore();
    await assertFails(updateDoc(doc(self, "users/newbie"), { approved: true }));

    const admin = env.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(updateDoc(doc(admin, "users/newbie"), { approved: true }));
  });

  it("a user may edit only their own profile fields (name/university/usage)", async () => {
    const self = env.authenticatedContext("newbie").firestore();
    // Whitelisted fields are allowed.
    await assertSucceeds(updateDoc(doc(self, "users/newbie"), { name: "New Name", university: "State U" }));
    await assertSucceeds(
      updateDoc(doc(self, "users/newbie"), { usage: { sessions: 2, students: 40, updatedAt: 1 } }),
    );
    // Non-whitelisted fields are rejected, even alongside an allowed one.
    await assertFails(updateDoc(doc(self, "users/newbie"), { email: "evil@x.edu" }));
    await assertFails(updateDoc(doc(self, "users/newbie"), { name: "X", approved: true }));
    await assertFails(updateDoc(doc(self, "users/newbie"), { createdAt: 0 }));
  });

  it("registration must start unapproved", async () => {
    const fresh = env.authenticatedContext("fresh").firestore();
    await assertFails(
      setDoc(doc(fresh, "users/fresh"), { name: "F", email: "f@x.edu", approved: true, createdAt: 1 }),
    );
    await assertSucceeds(
      setDoc(doc(fresh, "users/fresh"), { name: "F", email: "f@x.edu", approved: false, createdAt: 1 }),
    );
  });

  it("owners can purge student data", async () => {
    const owner = env.authenticatedContext("owner1").firestore();
    await assertSucceeds(deleteDoc(doc(owner, "sessions/s1/students/hashA")));
    await assertSucceeds(deleteDoc(doc(owner, "sessions/s1/results/allocation")));
  });

  // ---------- team management ----------

  const AES_ENV = { iv: "iv", ciphertext: "ct" };
  const EMPTY_CONTRACT = {
    status: "empty",
    updatedAt: 0,
    updatedByCodeIndex: null,
    content: null,
    contentForInstructor: null,
    feedback: null,
    feedbackAt: null,
    finalizedAt: null,
  };
  const DRAFT_CONTRACT = {
    status: "draft",
    updatedAt: 10,
    updatedByCodeIndex: 3,
    content: AES_ENV,
    contentForInstructor: VALID_PAYLOAD,
    feedback: null,
    feedbackAt: null,
    finalizedAt: null,
  };

  async function enableTeamMgmt(round: "pending" | "open" | "closed" = "open") {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await updateDoc(doc(db, "sessions/s1"), {
        status: "closed",
        teamMgmt: {
          enabled: true,
          rosterUploadedAt: 1,
          factorFloor: 0.8,
          factorCeiling: 1.1,
          includeBehaviors: true,
          behaviors: ["a", "b", "c", "d"],
          aiFeedbackEnabled: true,
          rounds: {
            formative: { status: round },
            summative: { status: "pending" },
          },
        },
      });
      await setDoc(doc(db, "sessions/s1/teams/tok1"), {
        teamLabel: "Team 1",
        createdAt: 1,
        contract: EMPTY_CONTRACT,
      });
    });
  }

  it("students can submit a peer eval only for the open round, with valid shape", async () => {
    await enableTeamMgmt("open");
    const student = env.authenticatedContext("anonuser").firestore();
    const sub = { submittedAt: 5, payload: VALID_PAYLOAD };
    await assertSucceeds(updateDoc(doc(student, "sessions/s1/students/hashA"), { peerEvalFormative: sub }));
    // Withdraw (null) is allowed while open.
    await assertSucceeds(updateDoc(doc(student, "sessions/s1/students/hashA"), { peerEvalFormative: null }));
    // The summative round is still pending — writing it is rejected.
    await assertFails(updateDoc(doc(student, "sessions/s1/students/hashA"), { peerEvalSummative: sub }));
    // Cannot write both rounds in one update.
    await assertFails(
      updateDoc(doc(student, "sessions/s1/students/hashA"), { peerEvalFormative: sub, peerEvalSummative: sub }),
    );
    // Malformed submission (bad payload) rejected.
    await assertFails(
      updateDoc(doc(student, "sessions/s1/students/hashA"), { peerEvalFormative: { submittedAt: 5, payload: "x" } }),
    );
    // Cannot write the instructor-only roster/result fields.
    await assertFails(updateDoc(doc(student, "sessions/s1/students/hashA"), { roster: AES_ENV }));
    await assertFails(updateDoc(doc(student, "sessions/s1/students/hashA"), { resultFormative: AES_ENV }));
  });

  it("students cannot submit a peer eval when the round is closed or pending", async () => {
    await enableTeamMgmt("closed");
    const student = env.authenticatedContext("anonuser").firestore();
    const sub = { submittedAt: 5, payload: VALID_PAYLOAD };
    await assertFails(updateDoc(doc(student, "sessions/s1/students/hashA"), { peerEvalFormative: sub }));
  });

  it("anyone signed in can get a team doc by id but not list", async () => {
    await enableTeamMgmt("open");
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, "sessions/s1/teams/tok1")));

    const student = env.authenticatedContext("anonuser").firestore();
    await assertSucceeds(getDoc(doc(student, "sessions/s1/teams/tok1")));
    await assertFails(getDocs(collection(student, "sessions/s1/teams")));
  });

  it("team members can update the contract with a valid shape; not the label", async () => {
    await enableTeamMgmt("open");
    const student = env.authenticatedContext("anonuser").firestore();
    await assertSucceeds(updateDoc(doc(student, "sessions/s1/teams/tok1"), { contract: DRAFT_CONTRACT }));
    // Changing teamLabel is owner-only.
    await assertFails(updateDoc(doc(student, "sessions/s1/teams/tok1"), { teamLabel: "Hacked" }));
    // Malformed contract (bad envelope) rejected.
    await assertFails(
      updateDoc(doc(student, "sessions/s1/teams/tok1"), { contract: { ...DRAFT_CONTRACT, content: "nope" } }),
    );
  });

  it("students cannot update a contract when team management is disabled", async () => {
    // teamMgmt not set on the seeded session.
    const student = env.authenticatedContext("anonuser").firestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "sessions/s1/teams/tok1"), {
        teamLabel: "Team 1",
        createdAt: 1,
        contract: EMPTY_CONTRACT,
      });
    });
    await assertFails(updateDoc(doc(student, "sessions/s1/teams/tok1"), { contract: DRAFT_CONTRACT }));
  });

  it("owners manage teams and the team directory; non-owners cannot", async () => {
    await enableTeamMgmt("open");
    const owner = env.authenticatedContext("owner1").firestore();
    await assertSucceeds(getDocs(collection(owner, "sessions/s1/teams")));
    await assertSucceeds(setDoc(doc(owner, "sessions/s1/teams/tok2"), { teamLabel: "Team 2", createdAt: 1, contract: EMPTY_CONTRACT }));
    await assertSucceeds(updateDoc(doc(owner, "sessions/s1/students/hashA"), { roster: AES_ENV }));
    await assertSucceeds(setDoc(doc(owner, "sessions/s1/results/teamDirectory"), { payload: VALID_PAYLOAD, updatedAt: 1 }));

    const other = env.authenticatedContext("other").firestore();
    await assertFails(getDocs(collection(other, "sessions/s1/teams")));
    await assertFails(getDoc(doc(other, "sessions/s1/results/teamDirectory")));
  });
});
