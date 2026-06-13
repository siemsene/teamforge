import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { setInstructorApproved, watchAllInstructors } from "../../lib/db";
import { useAuth } from "../auth/AuthContext";
import type { InstructorProfile, InstructorUsage } from "../../types";
import { Badge, Button, Card, Spinner } from "../../components/ui";

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

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">Admin — instructor approval</h1>
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
                  <Button onClick={() => setInstructorApproved(r.uid, true)}>Approve</Button>
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
