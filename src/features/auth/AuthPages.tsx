import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth, ADMIN_UID } from "../../lib/firebase";
import { createInstructorProfile } from "../../lib/db";
import { notifyAdminOfRegistration } from "../../lib/email";
import { useAuth } from "./AuthContext";
import { Button, Card, ErrorText, Field, Input, Spinner } from "../../components/ui";

function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto mt-16 max-w-md px-4">
      <h1 className="mb-4 text-center text-2xl font-bold">{title}</h1>
      <Card>{children}</Card>
    </div>
  );
}

export function SignUpPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (name.trim().length < 2) return setError("Please enter your real name.");
    setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await createInstructorProfile(cred.user.uid, name.trim(), email.trim());
      // Fire-and-forget: a failed notification must not block registration.
      void notifyAdminOfRegistration(name.trim(), email.trim());
      await sendEmailVerification(cred.user);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Instructor registration">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Full name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Jane Doe" required />
        </Field>
        <Field label="Email" hint="Use your institutional email — accounts are manually approved.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Creating account…" : "Register"}
        </Button>
        <p className="text-center text-sm text-slate-500">
          Already registered?{" "}
          <Link className="text-indigo-600 hover:underline" to="/signin">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function SignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate(cred.user.uid === ADMIN_UID ? "/admin" : "/dashboard");
    } catch {
      setError("Sign-in failed. Check your email and password.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!email.trim()) return setError("Enter your email first, then click reset.");
    await sendPasswordResetEmail(auth, email.trim());
    setInfo("Password reset email sent.");
  }

  return (
    <AuthShell title="Instructor sign-in">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorText>{error}</ErrorText>
        {info && <p className="text-sm text-green-700">{info}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <div className="flex justify-between text-sm">
          <button type="button" onClick={resetPassword} className="text-indigo-600 hover:underline">
            Forgot password?
          </button>
          <Link className="text-indigo-600 hover:underline" to="/signup">
            Register
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

/** Gates instructor pages: signed in -> email verified -> admin approved. */
export function RequireInstructor({ children }: { children: ReactNode }) {
  const { user, profile, loading } = useAuth();
  const [resendError, setResendError] = useState("");
  const [resendDone, setResendDone] = useState(false);

  async function resend() {
    setResendError("");
    setResendDone(false);
    try {
      await sendEmailVerification(user!);
      setResendDone(true);
    } catch (err) {
      setResendError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading) {
    return (
      <div className="mt-24 flex justify-center">
        <Spinner />
      </div>
    );
  }
  if (!user || user.isAnonymous) return <Navigate to="/signin" replace />;

  if (!user.emailVerified) {
    return (
      <AuthShell title="Verify your email">
        <p className="mb-3 text-sm text-slate-600">
          We sent a verification link to <strong>{user.email}</strong>. Click it, then reload this page.
        </p>
        {resendDone && <p className="mb-3 text-sm text-emerald-600">Verification email sent again.</p>}
        <ErrorText>{resendError}</ErrorText>
        <div className="flex gap-2">
          <Button onClick={resend}>Resend email</Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            I verified — reload
          </Button>
          <Button variant="ghost" onClick={() => signOut(auth)}>
            Sign out
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (!profile?.approved) {
    return (
      <AuthShell title="Awaiting approval">
        <p className="mb-3 text-sm text-slate-600">
          Your account is verified and is now waiting for manual approval by the site administrator. You will be able
          to create sessions once approved — check back soon.
        </p>
        <Button variant="ghost" onClick={() => signOut(auth)}>
          Sign out
        </Button>
      </AuthShell>
    );
  }

  return <>{children}</>;
}
