import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  watchAllocationUpdatedAt,
  watchProjects,
  watchPublicConfig,
  watchSession,
  watchStudents,
} from "../../lib/db";
import type { Project, PublicConfig, SessionDoc, StudentDoc } from "../../types";

export interface SessionState {
  sid: string;
  session: SessionDoc;
  publicConfig: PublicConfig;
  projects: Project[];
  students: (StudentDoc & { hash: string })[];
  /** When the allocation was last saved, or null if there is none. Plaintext,
   * so it is available before the session is unlocked. */
  allocationUpdatedAt: number | null;
  /** The unlocked session private key, shared across tabs for this page's
   * lifetime (memory only, never persisted). Null until the instructor unlocks. */
  sessionKey: CryptoKey | null;
  setSessionKey: (key: CryptoKey) => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({
  sid,
  children,
}: {
  sid: string;
  children: (loaded: boolean, problem?: string) => ReactNode;
}) {
  const [session, setSession] = useState<SessionDoc | null | undefined>(undefined);
  const [publicConfig, setPublicConfig] = useState<PublicConfig | null | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  const [students, setStudents] = useState<(StudentDoc & { hash: string })[]>([]);
  const [allocationUpdatedAt, setAllocationUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [sessionKey, setSessionKeyState] = useState<CryptoKey | null>(null);
  // Drop the unlocked key when navigating to a different session.
  const keyForSid = useRef(sid);
  if (keyForSid.current !== sid) {
    keyForSid.current = sid;
    if (sessionKey) setSessionKeyState(null);
  }

  useEffect(() => {
    setSession(undefined);
    setError("");
    return watchSession(sid, setSession, (err) => setError(err.message));
  }, [sid]);
  useEffect(() => {
    setPublicConfig(undefined);
    setError("");
    return watchPublicConfig(sid, setPublicConfig, (err) => setError(err.message));
  }, [sid]);
  useEffect(() => watchProjects(sid, setProjects), [sid]);
  useEffect(() => watchStudents(sid, setStudents), [sid]);
  useEffect(() => watchAllocationUpdatedAt(sid, setAllocationUpdatedAt), [sid]);

  const missing = session === null || publicConfig === null;
  const problem = missing || error ? error || "Session not found or no longer available." : undefined;
  const loaded = !!session && !!publicConfig && !error;
  return (
    <SessionContext.Provider
      value={
        loaded
          ? {
              sid,
              session: session!,
              publicConfig: publicConfig!,
              projects,
              students,
              allocationUpdatedAt,
              sessionKey,
              setSessionKey: setSessionKeyState,
            }
          : null
      }
    >
      {children(loaded, problem)}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside provider");
  return ctx;
}
