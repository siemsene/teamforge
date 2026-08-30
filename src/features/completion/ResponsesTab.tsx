import { useSession } from "../sessions/SessionContext";
import { Card } from "../../components/ui";
import { RosterPanel } from "./RosterPanel";
import { rosterStaleness } from "../sessions/rosterStaleness";

export function ResponsesTab() {
  const { students, session, allocationUpdatedAt } = useSession();
  const stale = rosterStaleness(session, allocationUpdatedAt);
  const submitted = students.filter((s) => s.submittedAt).length;
  const pct = students.length ? Math.round((submitted / students.length) * 100) : 0;

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold">Survey completion</h2>
          <span className="text-sm text-slate-600">
            {submitted} / {students.length} ({pct}%)
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        {session.status !== "open" && (
          <p className="mt-2 text-xs text-amber-700">
            The session is {session.status} — students can only submit while it is open.
          </p>
        )}
      </Card>

      {(stale.allocationStale || stale.teamRosterStale) && (
        <Card className="border-amber-200 bg-amber-50">
          <h2 className="mb-1 font-semibold text-amber-900">Your roster has changed</h2>
          <ul className="list-disc pl-5 text-sm text-amber-900">
            {stale.allocationStale && (
              <li>
                The saved allocation was worked out from an earlier roster. Re-run the optimizer on the{" "}
                <strong>Allocation</strong> tab and save.
              </li>
            )}
            {stale.teamRosterStale && (
              <li>
                Teams were provisioned from an earlier roster. Re-upload your login-codes CSV on the{" "}
                <strong>Teams</strong> tab.
              </li>
            )}
          </ul>
        </Card>
      )}

      <RosterPanel />
    </div>
  );
}
