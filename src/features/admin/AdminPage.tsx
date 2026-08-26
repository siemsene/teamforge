import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { setInstructorApproved, watchAllInstructors } from "../../lib/db";
import { approvalEmailHref } from "../../lib/email";
import { useAuth } from "../auth/AuthContext";
import type { InstructorProfile, InstructorUsage } from "../../types";
import { Badge, Button, Card, ErrorText, Spinner } from "../../components/ui";

function formatUsage(usage: InstructorUsage | undefined): string {
  if (!usage) return "No usage data yet";
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return `${plural(usage.sessions, "session")} · ${plural(usage.students, "student")} · updated ${new Date(
    usage.updatedAt,
  ).toLocaleDateString()}`;
}

export function AdminPage() {
  const { isAdmin, loading } = useAuth();
  const [rows, setRows] = useState<(InstructorProfile & { uid: string })[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    return watchAllInstructors(setRows);
  }, [isAdmin]);

  if (loading) return <Spinner />;
  if (!isAdmin) return <Navigate to="/" replace />;

  const pending = rows?.filter((r) => !r.approved) ?? [];
  // Heaviest data users first, so the admin can nudge them to clean up.
  const approved = (rows?.filter((r) => r.approved) ?? []).sort(
    (a, b) => (b.usage?.students ?? 0) - (a.usage?.students ?? 0),
  );

  async function approveInstructor(row: InstructorProfile & { uid: string }) {
    setError("");
    try {
      await setInstructorApproved(row.uid, true);
      // Hand the mailto to the OS in a throwaway tab rather than navigating this
      // one: with no mail client registered, assigning location.href leaves the
      // admin staring at a blank page instead of the list they were working in.
      window.open(approvalEmailHref(row.name, row.email), "_blank", "noopener");
    } catch (e) {
      setError(`Could not approve instructor: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">Admin — instructor approval</h1>
      <ErrorText>{error}</ErrorText>
      {!rows ? (
        <Spinner />
      ) : (
        <>
          <Card>
            <h2 className="mb-3 font-semibold">Pending ({pending.length})</h2>
            {pending.length === 0 && <p className="text-sm text-slate-500">No pending registrations.</p>}
            <ul className="divide-y divide-slate-100">
              {pending.map((r) => (
                <li key={r.uid} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-medium">
                      {r.name}
                      {r.university && <span className="font-normal text-slate-500"> · {r.university}</span>}
                    </div>
                    <div className="text-sm text-slate-500">
                      {r.email} · registered {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Button onClick={() => approveInstructor(r)}>Approve</Button>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-1 font-semibold">Approved ({approved.length})</h2>
            <p className="mb-3 text-sm text-slate-500">
              Data usage helps you spot instructors to remind about deleting finished sessions.
            </p>
            <ul className="divide-y divide-slate-100">
              {approved.map((r) => (
                <li key={r.uid} className="flex items-center justify-between gap-4 py-2">
                  <div className="min-w-0">
                    <div>
                      <span className="font-medium">{r.name}</span>
                      {r.university && <span className="text-sm text-slate-500"> · {r.university}</span>}{" "}
                      <Badge tone="green">approved</Badge>
                    </div>
                    <div className="text-sm text-slate-500">{r.email}</div>
                    <div className="text-sm text-slate-500">{formatUsage(r.usage)}</div>
                  </div>
                  <Button variant="secondary" onClick={() => setInstructorApproved(r.uid, false)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
