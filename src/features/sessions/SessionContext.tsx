import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { watchProjects, watchPublicConfig, watchSession, watchStudents } from "../../lib/db";
import type { Project, PublicConfig, SessionDoc, StudentDoc } from "../../types";

export interface SessionState {
  sid: string;
  session: SessionDoc;
  publicConfig: PublicConfig;
  projects: Project[];
  students: (StudentDoc & { hash: string })[];
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ sid, children }: { sid: string; children: (loaded: boolean) => ReactNode }) {
  const [session, setSession] = useState<SessionDoc | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicConfig | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [students, setStudents] = useState<(StudentDoc & { hash: string })[]>([]);

  useEffect(() => watchSession(sid, setSession), [sid]);
  useEffect(() => watchPublicConfig(sid, setPublicConfig), [sid]);
  useEffect(() => watchProjects(sid, setProjects), [sid]);
  useEffect(() => watchStudents(sid, setStudents), [sid]);

  const loaded = !!session && !!publicConfig;
  return (
    <SessionContext.Provider
      value={loaded ? { sid, session: session!, publicConfig: publicConfig!, projects, students } : null}
    >
      {children(loaded)}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside provider");
  return ctx;
}
