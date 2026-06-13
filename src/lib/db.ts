// Typed Firestore access. Collection layout:
//   users/{uid}                          instructor profiles
//   sessions/{sid}                       owner-only session doc
//   sessions/{sid}/public/config         student-readable survey config
//   sessions/{sid}/projects/{pid}        owner-only project definitions
//   sessions/{sid}/students/{codeHash}   encrypted responses, doc id = SHA-256(code)
//   sessions/{sid}/results/allocation    encrypted allocation

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import type {
  Allocation,
  AllocationDoc,
  EciesPayload,
  InstructorProfile,
  InstructorUsage,
  Project,
  PublicConfig,
  SessionDoc,
  SessionSummary,
  StudentDoc,
} from "../types";

// ---------- instructors ----------

export async function createInstructorProfile(
  uid: string,
  name: string,
  email: string,
  university: string,
): Promise<void> {
  const profile: InstructorProfile = {
    name,
    email,
    university,
    approved: false,
    createdAt: Date.now(),
    usage: { sessions: 0, students: 0, updatedAt: Date.now() },
  };
  await setDoc(doc(db, "users", uid), profile);
}

/** Refreshes the instructor's data-usage summary (does not touch the approved flag). */
export async function updateInstructorUsage(uid: string, usage: InstructorUsage): Promise<void> {
  await updateDoc(doc(db, "users", uid), { usage });
}

export function watchProfile(uid: string, cb: (p: InstructorProfile | null) => void): Unsubscribe {
  return onSnapshot(doc(db, "users", uid), (snap) => {
    cb(snap.exists() ? (snap.data() as InstructorProfile) : null);
  });
}

export function watchAllInstructors(cb: (rows: (InstructorProfile & { uid: string })[]) => void): Unsubscribe {
  return onSnapshot(collection(db, "users"), (snap) => {
    cb(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as InstructorProfile) })));
  });
}

export async function setInstructorApproved(uid: string, approved: boolean): Promise<void> {
  await updateDoc(doc(db, "users", uid), { approved });
}

// ---------- sessions ----------

export async function createSession(
  sid: string,
  session: SessionDoc,
  publicConfig: PublicConfig,
  roster: { hash: string; shareCode: string }[],
): Promise<void> {
  // The session doc must be committed first and on its own: the rules for the
  // public/config doc (and the student docs below) call ownsSession(sid), which
  // does a get() on sessions/{sid}. Security-rule get()/exists() see only
  // committed data, never sibling writes in the same batch — so bundling the
  // session doc with its public/config would make that get() find nothing and
  // the whole batch would fail with "Missing or insufficient permissions".
  await setDoc(doc(db, "sessions", sid), session);
  await setDoc(doc(db, "sessions", sid, "public", "config"), publicConfig);

  // Firestore batches cap at 500 writes; chunk the student docs.

  for (let i = 0; i < roster.length; i += 450) {
    const batch = writeBatch(db);
    roster.slice(i, i + 450).forEach((entry, j) => {
      const student: StudentDoc = {
        codeIndex: i + j + 1,
        shareCode: entry.shareCode,
        submittedAt: null,
        response: null,
      };
      batch.set(doc(db, "sessions", sid, "students", entry.hash), student);
    });
    await batch.commit();
  }
}

export function watchSessions(ownerUid: string, cb: (rows: SessionSummary[]) => void): Unsubscribe {
  const q = query(collection(db, "sessions"), where("ownerUid", "==", ownerUid));
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as SessionDoc) }));
    rows.sort((a, b) => b.createdAt - a.createdAt);
    cb(rows);
  });
}

export function watchSession(sid: string, cb: (s: SessionDoc | null) => void): Unsubscribe {
  return onSnapshot(doc(db, "sessions", sid), (snap) => {
    cb(snap.exists() ? (snap.data() as SessionDoc) : null);
  });
}

export async function updateSession(sid: string, patch: Partial<SessionDoc>): Promise<void> {
  await updateDoc(doc(db, "sessions", sid), { ...patch, updatedAt: Date.now() });
}

// ---------- public config (the student-facing mirror) ----------

export function watchPublicConfig(sid: string, cb: (c: PublicConfig | null) => void): Unsubscribe {
  return onSnapshot(doc(db, "sessions", sid, "public", "config"), (snap) => {
    cb(snap.exists() ? (snap.data() as PublicConfig) : null);
  });
}

export async function getPublicConfig(sid: string): Promise<PublicConfig | null> {
  const snap = await getDoc(doc(db, "sessions", sid, "public", "config"));
  return snap.exists() ? (snap.data() as PublicConfig) : null;
}

export async function updatePublicConfig(sid: string, patch: Partial<PublicConfig>): Promise<void> {
  await updateDoc(doc(db, "sessions", sid, "public", "config"), patch);
}

// ---------- projects ----------

export function watchProjects(sid: string, cb: (rows: Project[]) => void): Unsubscribe {
  return onSnapshot(collection(db, "sessions", sid, "projects"), (snap) => {
    const rows = snap.docs.map((d) => d.data() as Project);
    rows.sort((a, b) => a.name.localeCompare(b.name));
    cb(rows);
  });
}

export async function saveProject(sid: string, project: Project): Promise<void> {
  await setDoc(doc(db, "sessions", sid, "projects", project.id), project);
}

export async function deleteProject(sid: string, pid: string): Promise<void> {
  await deleteDoc(doc(db, "sessions", sid, "projects", pid));
}

// ---------- students ----------

export function watchStudents(sid: string, cb: (rows: (StudentDoc & { hash: string })[]) => void): Unsubscribe {
  return onSnapshot(collection(db, "sessions", sid, "students"), (snap) => {
    const rows = snap.docs.map((d) => ({ hash: d.id, ...(d.data() as StudentDoc) }));
    rows.sort((a, b) => a.codeIndex - b.codeIndex);
    cb(rows);
  });
}

/** Student-side lookup: succeeds only with a valid code (rules forbid listing). */
export async function getStudentByHash(sid: string, hash: string): Promise<StudentDoc | null> {
  const snap = await getDoc(doc(db, "sessions", sid, "students", hash));
  return snap.exists() ? (snap.data() as StudentDoc) : null;
}

export async function submitResponse(sid: string, hash: string, response: EciesPayload): Promise<void> {
  await updateDoc(doc(db, "sessions", sid, "students", hash), {
    response,
    submittedAt: Date.now(),
  });
}

export async function withdrawResponse(sid: string, hash: string): Promise<void> {
  await updateDoc(doc(db, "sessions", sid, "students", hash), {
    response: null,
    submittedAt: null,
  });
}

// ---------- allocation ----------

export async function saveAllocation(sid: string, payload: EciesPayload): Promise<void> {
  const docData: AllocationDoc = { payload, updatedAt: Date.now() };
  await setDoc(doc(db, "sessions", sid, "results", "allocation"), docData);
}

export async function getAllocationDoc(sid: string): Promise<AllocationDoc | null> {
  const snap = await getDoc(doc(db, "sessions", sid, "results", "allocation"));
  return snap.exists() ? (snap.data() as AllocationDoc) : null;
}

export type { Allocation };

// ---------- deletion (requirement C: instructor can purge everything) ----------

async function deleteCollectionDocs(sid: string, sub: string): Promise<number> {
  const snap = await getDocs(collection(db, "sessions", sid, sub));
  for (let i = 0; i < snap.docs.length; i += 450) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 450).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  return snap.docs.length;
}

/** Removes every student response and the allocation. Keeps the session shell. */
export async function purgeStudentData(sid: string): Promise<number> {
  const n = await deleteCollectionDocs(sid, "students");
  await deleteDoc(doc(db, "sessions", sid, "results", "allocation")).catch(() => {});
  return n;
}

/** Deletes the entire session including all subcollections. */
export async function deleteSessionCompletely(sid: string): Promise<void> {
  await deleteCollectionDocs(sid, "students");
  await deleteCollectionDocs(sid, "projects");
  await deleteCollectionDocs(sid, "results");
  // The "public" subcollection only ever holds the single "config" doc, and the
  // rules grant get/write on it but not list — so delete it directly rather than
  // via a (forbidden) collection query.
  await deleteDoc(doc(db, "sessions", sid, "public", "config")).catch(() => {});
  await deleteDoc(doc(db, "sessions", sid));
}
