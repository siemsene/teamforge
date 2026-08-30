import { NavLink, Navigate, Route, Routes, useParams } from "react-router-dom";
import { SessionProvider, useSession } from "./SessionContext";
import { OverviewTab } from "./OverviewTab";
import { PrivacyTab } from "./PrivacyTab";
import { ProjectsTab } from "../projects/ProjectsTab";
import { SurveyTab } from "../survey-builder/SurveyTab";
import { ConstraintsTab } from "../constraints/ConstraintsTab";
import { ResponsesTab } from "../completion/ResponsesTab";
import { AllocationTab } from "../allocation/AllocationTab";
import { TeamsTab } from "../teams/TeamsTab";
import { PeerEvalsTab } from "../evals/PeerEvalsTab";
import { Badge, Spinner } from "../../components/ui";
import { getSessionReadiness } from "./readiness";

const STATUS_TONE = { draft: "gray", open: "green", closed: "amber" } as const;

function Tabs() {
  const { session } = useSession();
  const teamMgmt = !!session.teamMgmt?.enabled;
  const tabs = [
    { to: "", label: "Overview", end: true },
    ...(session.genericProjects ? [] : [{ to: "projects", label: "Projects" }]),
    { to: "survey", label: "Survey" },
    { to: "constraints", label: "Constraints" },
    { to: "responses", label: "Roster" },
    { to: "allocation", label: "Allocation" },
    ...(teamMgmt
      ? [
          { to: "teams", label: "Teams" },
          { to: "evals", label: "Peer evals" },
        ]
      : []),
    { to: "privacy", label: "Privacy & data" },
  ];
  return (
    <div className="mb-6 border-b border-slate-200">
      <div className="flex items-center gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={"end" in t}
            className={({ isActive }) =>
              `whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                isActive
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

function SessionBody() {
  const { session, publicConfig, projects, students } = useSession();
  const readiness = getSessionReadiness(session, publicConfig, projects, students.length);
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-2xl font-bold">{session.title}</h1>
        <Badge tone={STATUS_TONE[session.status]}>{session.status}</Badge>
        {session.teamMgmt?.enabled && <Badge tone="indigo">team management</Badge>}
      </div>
      <SetupProgress
        hasProjects={session.genericProjects || projects.length > 0}
        hasSurvey={publicConfig.questions.length > 0}
        hasConstraints={session.constraints.length > 0}
        isReady={readiness.blockers.length === 0}
        submitted={students.filter((s) => s.submittedAt).length}
        total={students.length}
        hasAllocation={session.status === "closed"}
        teamMgmt={
          session.teamMgmt?.enabled
            ? { rostered: session.teamMgmt.rosterUploadedAt != null }
            : undefined
        }
      />
      <Tabs />
      <Routes>
        <Route index element={<OverviewTab />} />
        <Route path="projects" element={<ProjectsTab />} />
        <Route path="survey" element={<SurveyTab />} />
        <Route path="constraints" element={<ConstraintsTab />} />
        <Route path="responses" element={<ResponsesTab />} />
        <Route path="allocation" element={<AllocationTab />} />
        <Route path="teams" element={<TeamsTab />} />
        <Route path="evals" element={<PeerEvalsTab />} />
        <Route path="privacy" element={<PrivacyTab />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </div>
  );
}

function SetupProgress({
  hasProjects,
  hasSurvey,
  hasConstraints,
  isReady,
  submitted,
  total,
  hasAllocation,
  teamMgmt,
}: {
  hasProjects: boolean;
  hasSurvey: boolean;
  hasConstraints: boolean;
  isReady: boolean;
  submitted: number;
  total: number;
  hasAllocation: boolean;
  teamMgmt?: { rostered: boolean };
}) {
  const steps = [
    { label: "Teams", done: hasProjects },
    { label: "Survey", done: hasSurvey },
    { label: "Goals", done: hasConstraints },
    { label: "Ready", done: isReady },
    { label: "Responses", done: total > 0 && submitted === total, note: `${submitted}/${total}` },
    { label: "Allocation", done: hasAllocation },
    // "Teams uploaded" rather than "Roster": the Roster tab is now where the
    // class list is edited, and two steps called the same thing meaning
    // different things is worse than a longer label.
    ...(teamMgmt ? [{ label: "Teams uploaded", done: teamMgmt.rostered }] : []),
  ];
  return (
    <div className="mb-4 overflow-x-auto rounded-md border border-slate-200 bg-white px-3 py-2">
      <ol className="flex min-w-max items-center gap-2 text-xs">
        {steps.map((step, i) => (
          <li key={step.label} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-5 bg-slate-200" />}
            <span
              className={`rounded-full px-2 py-1 font-medium ${
                step.done ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
              }`}
            >
              {step.label}
              {step.note ? ` ${step.note}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SessionPage() {
  const { sid } = useParams<{ sid: string }>();
  if (!sid) return <Navigate to="/dashboard" replace />;
  return (
    <SessionProvider sid={sid}>
      {(loaded, problem) =>
        loaded ? (
          <SessionBody />
        ) : problem ? (
          <div className="mx-auto mt-16 max-w-xl rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {problem}
          </div>
        ) : (
          <div className="mt-24 flex justify-center">
            <Spinner label="Loading session…" />
          </div>
        )
      }
    </SessionProvider>
  );
}
