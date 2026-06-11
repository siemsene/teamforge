import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, ADMIN_UID } from "../../lib/firebase";
import { watchProfile } from "../../lib/db";
import type { InstructorProfile } from "../../types";

interface AuthState {
  user: User | null;
  profile: InstructorProfile | null;
  isAdmin: boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, profile: null, isAdmin: false, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<InstructorProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setProfile(null);
        setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    // Anonymous student sign-ins have no instructor profile.
    if (!user || user.isAnonymous) {
      if (user) setLoading(false);
      return;
    }
    setLoading(true);
    return watchProfile(user.uid, (p) => {
      setProfile(p);
      setLoading(false);
    });
  }, [user]);

  const isAdmin = !!user && !user.isAnonymous && user.uid === ADMIN_UID;
  return <AuthContext.Provider value={{ user, profile, isAdmin, loading }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
