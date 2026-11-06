import { LOW_BEHAVIOR_AVERAGE, LOW_SINGLE_SHARE, type TroubleReport } from "../../lib/evalConcerns";
import { LOW_FACTOR_FLAG } from "../../lib/teamFactor";
import { printAs, reportPdfName } from "../../lib/printPdf";
import { Badge, Button } from "../../components/ui";

/**
 * Everything in a computed round worth a conversation, worst first. Rendered
 * twice: once on screen, and once inside `.print-only` so "Print / save as PDF"
 * produces just the report (see the print styles in index.css).
 */
export function TroubleSpots({
  report,
  sessionTitle,
  roundLabel,
}: {
  report: TroubleReport;
  sessionTitle: string;
  roundLabel: string;
}) {
  return (
    <div className="mt-4 rounded-md border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Trouble spots</h3>
        <Button variant="secondary" onClick={() => printAs(reportPdfName(sessionTitle, roundLabel))}>
          Print / save as PDF
        </Button>
      </div>
      <TroubleReportBody report={report} />
      <div className="print-only">
        <h1 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "2px" }}>Peer evaluation — trouble spots</h1>
        <p style={{ color: "#334155", marginBottom: "16px" }}>
          {sessionTitle} · {roundLabel} · {new Date().toLocaleDateString()}
        </p>
        <TroubleReportBody report={report} />
      </div>
    </div>
  );
}

function TroubleReportBody({ report }: { report: TroubleReport }) {
  const flaggedStudents = report.teams.reduce((n, t) => n + t.students.length, 0);
  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-600">
        {flaggedStudents === 0 && report.teams.length === 0
          ? `Nothing flagged across ${report.studentCount} students.`
          : `${flaggedStudents} of ${report.studentCount} students and ${report.teams.length} team${report.teams.length === 1 ? "" : "s"} flagged, worst first.`}{" "}
        <span className="text-slate-500">
          Flagged: a factor below {LOW_FACTOR_FLAG.toFixed(2)}, a unanimous low rating, a behaviour averaging below{" "}
          {LOW_BEHAVIOR_AVERAGE.toFixed(1)}, or any one teammate giving under {LOW_SINGLE_SHARE.toFixed(2)} of an even
          split.
        </span>
      </p>

      {report.teams.map((team) => (
        <section key={team.teamLabel} className="rounded-md border border-slate-200" style={{ breakInside: "avoid" }}>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
            <span className="font-medium">{team.teamLabel}</span>
            {team.reasons.map((r) => (
              <Badge key={r} tone="amber">
                {r}
              </Badge>
            ))}
          </div>
          {team.students.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {team.students.map((s) => (
                <li key={s.codeIndex} className="px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-xs tabular-nums text-slate-500">
                      factor <strong className="text-slate-800">{s.factor.toFixed(2)}</strong> · share{" "}
                      {s.share.toFixed(2)} · {s.raterCount} rater{s.raterCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul className="mt-1 list-disc pl-5 text-slate-700">
                    {s.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  {s.lowBehaviors.length > 0 && (
                    <p className="mt-1 text-slate-700">
                      <span className="text-slate-500">Lowest behaviours:</span>{" "}
                      {s.lowBehaviors.map((b) => `${b.label} ${b.average.toFixed(1)}`).join(" · ")}
                    </p>
                  )}
                  {s.lowAllocations.length > 0 && (
                    <div className="mt-1">
                      <p className="text-slate-500">Teammates who gave them less than an even split:</p>
                      <ul className="mt-0.5 space-y-0.5 pl-5">
                        {s.lowAllocations.map((a) => (
                          <li key={a.rater}>
                            <span className="tabular-nums">
                              {a.rater}: {a.points} pts (even {a.evenSplit.toFixed(1)})
                            </span>
                            {a.justification && <span className="italic text-slate-700"> — “{a.justification}”</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {report.comments.length > 0 && (
        <section style={{ breakInside: "avoid" }}>
          <h4 className="mb-1 font-medium">Confidential comments to you ({report.comments.length})</h4>
          <ul className="space-y-1">
            {report.comments.map((c, i) => (
              <li key={i}>
                <span className="text-slate-500">
                  {c.rater}, {c.teamLabel}:
                </span>{" "}
                <span className="whitespace-pre-wrap">{c.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.factorHidden.length > 0 && (
        <section style={{ breakInside: "avoid" }}>
          <h4 className="mb-1 font-medium">Factor not shown to the student</h4>
          <p className="mb-1 text-slate-500">
            Rated by fewer than two teammates, so they were shown 1.00. These are the real values — only you see them.
          </p>
          <p>{report.factorHidden.map((h) => `${h.name} (${h.teamLabel}) ${h.factor.toFixed(2)}`).join(" · ")}</p>
        </section>
      )}

      {report.nonSubmitters.length > 0 && (
        <section style={{ breakInside: "avoid" }}>
          <h4 className="mb-1 font-medium">Did not submit</h4>
          <ul className="space-y-0.5">
            {report.nonSubmitters.map((t) => (
              <li key={t.teamLabel}>
                <span className="text-slate-500">{t.teamLabel}:</span> {t.names.join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
