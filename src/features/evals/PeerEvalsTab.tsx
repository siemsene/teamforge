import { useState } from "react";
import { useSession } from "../sessions/SessionContext";
import { saveTeamMgmt } from "../../lib/db";
import { publicTeamMgmt } from "../teams/contractTemplate";
import { resolveFactorParams } from "../../lib/teamFactor";
import type { EvalRoundId, RoundStatus, TeamMgmtConfig } from "../../types";
import { Button, Card, ErrorText, Field, NumberInput } from "../../components/ui";
import { EvalReview } from "./EvalReview";

const ROUND_LABEL: Record<EvalRoundId, string> = { formative: "Practice (formative)", summative: "Graded (summative)" };
const STATUS_ORDER: RoundStatus[] = ["pending", "open", "closed"];

export function PeerEvalsTab() {
  const { session } = useSession();
  const tm = session.teamMgmt;

  if (!tm?.enabled || tm.rosterUploadedAt == null) {
    return (
      <Card>
        <p className="text-sm text-slate-600">
          Upload the team roster on the <strong>Teams</strong> tab first — peer evaluations need to know who is on each
          team.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsCard config={tm} />
      <RoundsCard config={tm} />
      <EvalReview />
    </div>
  );
}

function SettingsCard({ config }: { config: TeamMgmtConfig }) {
  const { sid } = useSession();
  const params = resolveFactorParams(config);
  const [floor, setFloor] = useState(params.factorFloor);
  const [ceiling, setCeiling] = useState(params.factorCeiling);
  const [deadband, setDeadband] = useState(params.deadband);
  const [damping, setDamping] = useState(params.damping);
  const [includeBehaviors, setIncludeBehaviors] = useState(config.includeBehaviors);
  const [aiEnabled, setAiEnabled] = useState(config.aiFeedbackEnabled);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const dirty =
    floor !== params.factorFloor ||
    ceiling !== params.factorCeiling ||
    deadband !== params.deadband ||
    damping !== params.damping ||
    includeBehaviors !== config.includeBehaviors ||
    aiEnabled !== config.aiFeedbackEnabled;

  async function save() {
    setBusy(true);
    setError("");
    try {
      const problem =
        floor >= ceiling
          ? "The floor must be below the ceiling."
          : floor > 1 || ceiling < 1
            ? "The floor and ceiling must straddle 1.00."
            : deadband < 0 || deadband >= 1
              ? "The dead band must be at least 0 and below 1."
              : damping <= 0 || damping > 1
                ? "Damping must be above 0 and at most 1."
                : "";
      if (problem) {
        setError(problem);
        setBusy(false);
        return;
      }
      const next: TeamMgmtConfig = {
        ...config,
        factorFloor: floor,
        factorCeiling: ceiling,
        deadband,
        damping,
        includeBehaviors,
        aiFeedbackEnabled: aiEnabled,
      };
      await saveTeamMgmt(sid, next, publicTeamMgmt(next));
      setMsg("Settings saved.");
      setTimeout(() => setMsg(""), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-2 font-semibold">Evaluation settings</h2>
      <p className="mb-3 text-sm text-slate-600">
        A share of 1.00 is an even split. Deviations within the dead band are treated as noise and leave the factor
        at exactly 1.00; beyond it the deviation is damped and then clipped. Keeping the ceiling tighter than the
        floor is deliberate — it is what stops a group profiting by agreeing to sink one member.{" "}
        <a
          className="text-indigo-600 hover:underline"
          href="/peer-eval-team-factor.xlsx"
          target="_blank"
          rel="noopener noreferrer"
        >
          Download the worked example
        </a>{" "}
        — a live spreadsheet of the same arithmetic, ready to share with students.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Team-factor floor">
          <NumberInput className="w-24" min={0.5} max={1} step={0.05} value={floor} onValueChange={setFloor} />
        </Field>
        <Field label="Team-factor ceiling">
          <NumberInput className="w-24" min={1} max={1.5} step={0.05} value={ceiling} onValueChange={setCeiling} />
        </Field>
        <Field label="Dead band (δ)">
          <NumberInput className="w-24" min={0} max={0.5} step={0.01} value={deadband} onValueChange={setDeadband} />
        </Field>
        <Field label="Damping (k)">
          <NumberInput className="w-24" min={0.1} max={1} step={0.05} value={damping} onValueChange={setDamping} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeBehaviors} onChange={(e) => setIncludeBehaviors(e.target.checked)} />
          Include behavior ratings (Part 2)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
          Offer AI contract feedback
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
        {msg && <span className="text-sm text-green-700">{msg}</span>}
      </div>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function RoundsCard({ config }: { config: TeamMgmtConfig }) {
  const { sid } = useSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function setStatus(round: EvalRoundId, status: RoundStatus) {
    setBusy(`${round}:${status}`);
    setError("");
    try {
      const prev = config.rounds[round];
      const now = Date.now();
      const next: TeamMgmtConfig = {
        ...config,
        rounds: {
          ...config.rounds,
          [round]: {
            ...prev,
            status,
            openedAt: status === "open" ? now : prev.openedAt,
            closedAt: status === "closed" ? now : prev.closedAt,
          },
        },
      };
      await saveTeamMgmt(sid, next, publicTeamMgmt(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function setNote(round: EvalRoundId, note: string) {
    const next: TeamMgmtConfig = {
      ...config,
      rounds: { ...config.rounds, [round]: { ...config.rounds[round], note } },
    };
    await saveTeamMgmt(sid, next, publicTeamMgmt(next)).catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }

  return (
    <Card>
      <h2 className="mb-2 font-semibold">Rounds</h2>
      <p className="mb-3 text-sm text-slate-600">
        Open a round so students can submit; close it before reviewing. The practice round is meant to be run first and
        its results returned privately; the graded round counts.
      </p>
      <div className="space-y-4">
        {(["formative", "summative"] as EvalRoundId[]).map((round) => {
          const cfg = config.rounds[round];
          return (
            <div key={round} className="rounded-md border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">{ROUND_LABEL[round]}</span>
                <span className="text-xs uppercase text-slate-500">{cfg.status}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {STATUS_ORDER.map((s) => (
                  <Button
                    key={s}
                    variant={cfg.status === s ? "primary" : "secondary"}
                    disabled={busy !== "" || cfg.status === s}
                    onClick={() => setStatus(round, s)}
                  >
                    {s === "pending" ? "Not open" : s === "open" ? "Open" : "Close"}
                  </Button>
                ))}
              </div>
              <NoteEditor initial={cfg.note ?? ""} onSave={(n) => setNote(round, n)} />
            </div>
          );
        })}
      </div>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function NoteEditor({ initial, onSave }: { initial: string; onSave: (n: string) => void }) {
  const [note, setNote] = useState(initial);
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        placeholder="Note shown to students, e.g. deadline"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button variant="ghost" onClick={() => onSave(note)} disabled={note === initial}>
        Save note
      </Button>
    </div>
  );
}
