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
import { TeamForgeLogo } from "../../components/Brand";
import { useAuth } from "./AuthContext";
import { Button, Card, ErrorText, Field, Input, Spinner } from "../../components/ui";

/**
 * Firebase's own error text ("Firebase: Error (auth/email-already-in-use).")
 * names the library and the error code, and tells the person reading it nothing
 * about what to do. Map the ones people actually hit.
 */
function authErrorMessage(err: unknown): string {
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
  switch (code) {
    case "auth/email-already-in-use":
      return "There is already an account with that email. Sign in instead, or use the password-reset link.";
    case "auth/invalid-email":
      return "That does not look like a valid email address.";
    case "auth/weak-password":
      return "Please choose a longer password — at least 8 characters.";
    case "auth/network-request-failed":
      return "Could not reach the server. Check your connection and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "auth/user-not-found":
      return "No account with that email. Check the address, or register a new account.";
    case "auth/operation-not-allowed":
      return "Email sign-up is not enabled on this deployment. Contact the site administrator.";
    default:
      return err instanceof Error ? err.message : String(err);
  }
}

function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto mt-16 max-w-md px-4">
      <Link
        to="/"
        className="mb-6 flex justify-center rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        <TeamForgeLogo markClassName="h-10 w-10" textClassName="text-xl" subtitle="Student team allocation" />
      </Link>
      <h1 className="mb-4 text-center text-2xl font-bold">{title}</h1>
      <Card>{children}</Card>
    </div>
  );
}

export function SignUpPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [university, setUniversity] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (name.trim().length < 2) return setError("Please enter your real name.");
    if (university.trim().length < 2) return setError("Please enter your university or institution.");
    setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      try {
        await createInstructorProfile(cred.user.uid, name.trim(), email.trim(), university.trim());
      } catch (profileErr) {
        // The account exists but has no profile, so every gate downstream reads
        // it as "awaiting approval" forever and there is no way back to this
        // form. Undo the half-registration so signing up again actually works.
        await cred.user.delete().catch(() => {});
        throw profileErr;
      }
      // Fire-and-forget: a failed notification must not block registration.
      void notifyAdminOfRegistration(name.trim(), email.trim(), university.trim());
      await sendEmailVerification(cred.user).catch(() => {
        /* The verify screen offers a resend button; do not fail registration. */
      });
      navigate("/dashboard");
    } catch (err) {
      setError(authErrorMessage(err));
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
        <Field label="University / institution">
          <Input
            value={university}
            onChange={(e) => setUniversity(e.target.value)}
            placeholder="State University"
            required
          />
        </Field>
        <Field
          label="Email"
          hint="Please sign up with your university email — it speeds up manual approval of your account."
        >
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
    setError("");
    setInfo("");
    if (!email.trim()) return setError("Enter your email first, then click reset.");
    try {
      await sendPasswordResetEmail(auth, email.trim());
      // Deliberately not "we found that account": confirming which addresses
      // are registered is not something a sign-in page should do.
      setInfo("If that address has an account, a password reset email is on its way.");
    } catch (err) {
      // Firebase reports an unknown address as auth/user-not-found unless email
      // enumeration protection is switched on. Swallow it into the same neutral
      // answer, so this page cannot be used to test whether an address is here.
      const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
      if (code === "auth/user-not-found") {
        setInfo("If that address has an account, a password reset email is on its way.");
        return;
      }
      setError(authErrorMessage(err));
    }
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
        <p className="mb-3 text-sm text-slate-600">
          Meanwhile, you can read the{" "}
          <a
            className="text-indigo-600 hover:underline"
            href="/instructor-guide.pdf"
            target="_blank"
            rel="noopener noreferrer"
          >
            instructor guide (PDF)
          </a>
          .
        </p>
        <Button variant="ghost" onClick={() => signOut(auth)}>
          Sign out
        </Button>
      </AuthShell>
    );
  }

  return <>{children}</>;
}
