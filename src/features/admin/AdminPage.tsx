import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { setInstructorApproved, watchAllInstructors } from "../../lib/db";
import { useAuth } from "../auth/AuthContext";
import type { InstructorProfile } from "../../types";
import { Badge, Button, Card, Spinner } from "../../components/ui";

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
  const approved = rows?.filter((r) => r.approved) ?? [];

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
                    <div className="font-medium">{r.name}</div>
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
            <h2 className="mb-3 font-semibold">Approved ({approved.length})</h2>
            <ul className="divide-y divide-slate-100">
              {approved.map((r) => (
                <li key={r.uid} className="flex items-center justify-between py-2">
                  <div>
                    <span className="font-medium">{r.name}</span>{" "}
                    <span className="text-sm text-slate-500">{r.email}</span>{" "}
                    <Badge tone="green">approved</Badge>
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
