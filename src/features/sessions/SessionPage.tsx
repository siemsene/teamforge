import { NavLink, Navigate, Route, Routes, useParams } from "react-router-dom";
import { SessionProvider, useSession } from "./SessionContext";
import { OverviewTab } from "./OverviewTab";
import { PrivacyTab } from "./PrivacyTab";
import { ProjectsTab } from "../projects/ProjectsTab";
import { SurveyTab } from "../survey-builder/SurveyTab";
import { ConstraintsTab } from "../constraints/ConstraintsTab";
import { ResponsesTab } from "../completion/ResponsesTab";
import { AllocationTab } from "../allocation/AllocationTab";
import { Badge, Spinner } from "../../components/ui";

const STATUS_TONE = { draft: "gray", open: "green", closed: "amber" } as const;

function Tabs() {
  const { session } = useSession();
  const tabs = [
    { to: "", label: "Overview", end: true },
    ...(session.genericProjects ? [] : [{ to: "projects", label: "Projects" }]),
    { to: "survey", label: "Survey" },
    { to: "constraints", label: "Constraints" },
    { to: "responses", label: "Responses" },
    { to: "allocation", label: "Allocation" },
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
  const { session } = useSession();
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-2xl font-bold">{session.title}</h1>
        <Badge tone={STATUS_TONE[session.status]}>{session.status}</Badge>
      </div>
      <Tabs />
      <Routes>
        <Route index element={<OverviewTab />} />
        <Route path="projects" element={<ProjectsTab />} />
        <Route path="survey" element={<SurveyTab />} />
        <Route path="constraints" element={<ConstraintsTab />} />
        <Route path="responses" element={<ResponsesTab />} />
        <Route path="allocation" element={<AllocationTab />} />
        <Route path="privacy" element={<PrivacyTab />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </div>
  );
}

export function SessionPage() {
  const { sid } = useParams<{ sid: string }>();
  if (!sid) return <Navigate to="/dashboard" replace />;
  return (
    <SessionProvider sid={sid}>
      {(loaded) =>
        loaded ? (
          <SessionBody />
        ) : (
          <div className="mt-24 flex justify-center">
            <Spinner label="Loading session…" />
          </div>
        )
      }
    </SessionProvider>
  );
}
