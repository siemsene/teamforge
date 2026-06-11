import { useSession } from "../sessions/SessionContext";
import { Card } from "../../components/ui";

export function ResponsesTab() {
  const { students, session } = useSession();
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

      <Card>
        <p className="mb-3 text-sm text-slate-600">
          Each tile is one login code (students stay anonymous here). Match the numbers against your private
          code-assignment CSV to remind specific students.
        </p>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10">
          {students.map((s) => (
            <div
              key={s.hash}
              title={s.submittedAt ? `Submitted ${new Date(s.submittedAt).toLocaleString()}` : "Not submitted"}
              className={`rounded-md px-2 py-1.5 text-center text-xs font-medium ${
                s.submittedAt ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-500"
              }`}
            >
              #{s.codeIndex}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
