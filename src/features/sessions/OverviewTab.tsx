import { useState } from "react";
import { useSession } from "./SessionContext";
import { updatePublicConfig, updateSession } from "../../lib/db";
import { surveyUrl } from "../../lib/util";
import type { SessionStatus } from "../../types";
import { Button, Card } from "../../components/ui";

async function setStatus(sid: string, status: SessionStatus) {
  await updateSession(sid, { status });
  await updatePublicConfig(sid, { status });
}

export function OverviewTab() {
  const { sid, session, students, publicConfig } = useSession();
  const [copied, setCopied] = useState("");
  const submitted = students.filter((s) => s.submittedAt).length;
  const link = surveyUrl(sid);

  const emailTemplate = `Subject: ${session.title} — team formation survey

Dear <STUDENT NAME>,

To help form project teams, please complete a short survey. Your responses are anonymous and encrypted — the platform never learns your name, and only I can read the answers (see the privacy notice on the survey page).

1. Open: ${link}
2. Enter your personal login code: <LOGIN CODE>

Please complete it by <DEADLINE>. If you want to team up with specific classmates, exchange login codes with them — the survey asks for codes of preferred teammates.

Thank you!`;

  async function copy(text: string, which: string) {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(""), 1500);
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 font-semibold">Session status</h2>
        <p className="mb-3 text-sm text-slate-600">
          <strong>Draft:</strong> set up projects, survey and constraints — students cannot submit yet.{" "}
          <strong>Open:</strong> students can complete the survey. <strong>Closed:</strong> submissions locked; run
          the allocation.
        </p>
        <div className="flex gap-2">
          {(["draft", "open", "closed"] as const).map((s) => (
            <Button
              key={s}
              variant={session.status === s ? "primary" : "secondary"}
              onClick={() => setStatus(sid, s)}
            >
              {s}
            </Button>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">At a glance</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-slate-500">Students</dt>
          <dd>{session.numStudents}</dd>
          <dt className="text-slate-500">Submitted</dt>
          <dd>
            {submitted} / {session.numStudents}
          </dd>
          <dt className="text-slate-500">Team size</dt>
          <dd>
            {session.minTeamSize}–{session.maxTeamSize} (ideal {session.idealTeamSize})
          </dd>
          <dt className="text-slate-500">Teams</dt>
          <dd>{session.genericProjects ? `${session.numTeams} generic` : "one per project"}</dd>
          <dt className="text-slate-500">Survey questions</dt>
          <dd>{publicConfig.questions.length}</dd>
          <dt className="text-slate-500">Constraints</dt>
          <dd>{session.constraints.length}</dd>
        </dl>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">Invite students</h2>
        <p className="mb-2 text-sm text-slate-600">
          Survey link:{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{link}</code>{" "}
          <Button variant="ghost" onClick={() => copy(link, "link")}>
            {copied === "link" ? "Copied!" : "Copy"}
          </Button>
        </p>
        <p className="mb-2 text-sm text-slate-600">
          Use the login-codes CSV you downloaded at creation to assign one code per student, then send each student
          the link and their code (mail merge works well). Template:
        </p>
        <pre className="mb-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-slate-700">
          {emailTemplate}
        </pre>
        <Button variant="secondary" onClick={() => copy(emailTemplate, "template")}>
          {copied === "template" ? "Copied!" : "Copy email template"}
        </Button>
      </Card>
    </div>
  );
}
