import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "./lib/firebase";
import { useAuth } from "./features/auth/AuthContext";
import { RequireInstructor, SignInPage, SignUpPage } from "./features/auth/AuthPages";
import { AdminPage } from "./features/admin/AdminPage";
import { DashboardPage } from "./features/sessions/DashboardPage";
import { SessionPage } from "./features/sessions/SessionPage";
import { StudentPage } from "./features/student/StudentPage";
import { watchAllInstructors } from "./lib/db";
import { TeamForgeLogo, TeamForgeMark } from "./components/Brand";
import { Badge, Button, Card } from "./components/ui";

function Header() {
  const { user, profile, isAdmin } = useAuth();
  const instructor = user && !user.isAnonymous;

  // Backstop for the email notification: show how many instructors are awaiting
  // review so the admin sees it on every page, even if a notification is missed.
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    if (!isAdmin) {
      setPendingCount(0);
      return;
    }
    return watchAllInstructors((rows) => setPendingCount(rows.filter((r) => !r.approved).length));
  }, [isAdmin]);

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link to="/" className="shrink-0 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
          <TeamForgeLogo markClassName="h-9 w-9" textClassName="text-lg" subtitle="Team allocation" />
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          {instructor ? (
            <>
              {isAdmin ? (
                // The admin manages approvals only; they don't own sessions.
                <Link to="/admin" className="flex items-center gap-1.5 text-slate-600 hover:text-indigo-700">
                  Admin
                  {pendingCount > 0 && <Badge tone="red">{pendingCount}</Badge>}
                </Link>
              ) : (
                <Link to="/dashboard" className="text-slate-600 hover:text-indigo-700">
                  My sessions
                </Link>
              )}
              {!isAdmin && (
                <a
                  href="/instructor-guide.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-600 hover:text-indigo-700"
                >
                  Guide
                </a>
              )}
              <span className="hidden text-slate-400 sm:inline">{profile?.name ?? user.email}</span>
              <Button variant="secondary" onClick={() => signOut(auth)}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link to="/signin" className="text-slate-600 hover:text-indigo-700">
                Instructor sign-in
              </Link>
              <Link to="/signup">
                <Button>Register</Button>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function LandingPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-12">
      <div className="text-center">
        <TeamForgeMark className="mx-auto mb-4 h-20 w-20" title="TeamForge logo" />
        <h1 className="text-4xl font-bold text-slate-950">TeamForge</h1>
        <p className="mx-auto mt-2 max-w-2xl text-lg text-slate-600">
          Privacy-preserving student team allocation: build a survey, collect anonymous responses, and let an
          optimizer form balanced teams.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">Instructors</h2>
          <p className="mb-3 text-sm text-slate-600">
            Create a session, describe projects, design the survey, define constraints, and run the optimizer — all
            from your browser.
          </p>
          <Link to="/signup">
            <Button>Register as instructor</Button>
          </Link>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Students</h2>
          <p className="mb-3 text-sm text-slate-600">
            Got a survey link and login code from your instructor? Open the link and enter your code — no account, no
            name, no email needed.
          </p>
        </Card>
      </div>
      <Card className="bg-indigo-50">
        <h2 className="mb-2 font-semibold">How your privacy is protected</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Students are identified only by random login codes — the platform never receives names or emails.</li>
          <li>
            Survey answers are <strong>encrypted in your browser</strong> before upload, so the server only ever
            stores ciphertext. The decryption key is never sent to the server — only the instructor can read responses.
          </li>
          <li>Team optimization runs entirely inside the instructor's browser — data never leaves it decrypted.</li>
          <li>Instructors can permanently erase all student data of a session at any time, with one click.</li>
          <li>No analytics, no tracking, no third-party scripts.</li>
        </ul>
      </Card>
    </div>
  );
}

/** A mistyped survey link is the likeliest way to land here, so say so rather
 * than leaving the header floating over an empty page. */
function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <Card>
        <h1 className="mb-2 text-xl font-bold">Page not found</h1>
        <p className="text-sm text-slate-600">
          There is nothing at this address. If you are a student, check the survey link your instructor sent you — it
          looks like <code className="rounded bg-slate-100 px-1 text-xs">/s/…</code> followed by a session id.
        </p>
        <p className="mt-3">
          <Link className="text-indigo-600 hover:underline" to="/">
            Go to the home page
          </Link>
        </p>
      </Card>
    </div>
  );
}

function HomeRoute() {
  const { isAdmin } = useAuth();
  // The admin's default view is the approval panel, not the marketing landing.
  return isAdmin ? <Navigate to="/admin" replace /> : <LandingPage />;
}

export default function App() {
  return (
    <div className="min-h-screen">
      <Header />
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route
          path="/dashboard"
          element={
            <RequireInstructor>
              <DashboardPage />
            </RequireInstructor>
          }
        />
        <Route
          path="/session/:sid/*"
          element={
            <RequireInstructor>
              <SessionPage />
            </RequireInstructor>
          }
        />
        <Route path="/s/:sid" element={<StudentPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}
