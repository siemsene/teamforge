import { useEffect, useRef, useState } from "react";
import { useSession } from "../sessions/SessionContext";
import { saveTeamMgmt } from "../../lib/db";
import { publicTeamMgmt } from "../teams/contractTemplate";
import {
  maxTeamSizeForNegativeSum,
  resolveFactorParams,
  scapegoatingIsNegativeSum,
  shareToFactor,
} from "../../lib/teamFactor";
import { neutralRange } from "../../lib/evalValidation";
import type { EvalRoundId, RoundStatus, TeamMgmtConfig } from "../../types";
import { Badge, Button, Card, ErrorText, Field, NumberInput } from "../../components/ui";
import { EvalReview } from "./EvalReview";
import { EmailTemplateCard } from "../../components/EmailTemplateCard";
import { emailContext, peerEvalEmail } from "../teams/emailTemplates";
import { CONTRACT_SECTIONS } from "../teams/contractTemplate";
import { surveyUrl } from "../../lib/util";

const ROUND_LABEL: Record<EvalRoundId, string> = { formative: "Practice (formative)", summative: "Graded (summative)" };
const STATUS_ORDER: RoundStatus[] = ["pending", "open", "closed"];
const STATUS_LABEL: Record<RoundStatus, string> = {
  pending: "Not open",
  open: "Open",
  closed: "Closed",
};
const STATUS_TONE: Record<RoundStatus, "gray" | "green" | "amber"> = {
  pending: "gray",
  open: "green",
  closed: "amber",
};

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
  const { sid, session } = useSession();
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

  // useState only reads its initial value once, so a config changed elsewhere —
  // another tab, or this instructor's own save — left the form showing stale
  // numbers and calling itself dirty against them. Re-seed when the saved
  // values actually move.
  const saved = `${params.factorFloor}|${params.factorCeiling}|${params.deadband}|${params.damping}|${config.includeBehaviors}|${config.aiFeedbackEnabled}`;
  const lastSaved = useRef(saved);
  useEffect(() => {
    if (lastSaved.current === saved) return;
    lastSaved.current = saved;
    setFloor(params.factorFloor);
    setCeiling(params.factorCeiling);
    setDeadband(params.deadband);
    setDamping(params.damping);
    setIncludeBehaviors(config.includeBehaviors);
    setAiEnabled(config.aiFeedbackEnabled);
  }, [saved, params.factorFloor, params.factorCeiling, params.deadband, params.damping, config.includeBehaviors, config.aiFeedbackEnabled]);

  // Uses the values currently in the form, so the effect is visible before saving.
  const previewParams = { factorFloor: floor, factorCeiling: ceiling, deadband, damping };
  // Worked through at the largest team this session actually allows, rather than
  // at a fixed five: the caps' most important property depends on team size, and
  // an example that quietly assumes a smaller team than the instructor set would
  // be reassuring about a session other than theirs.
  const exampleSize = Math.max(2, session.maxTeamSize);
  const preview = {
    band: neutralRange(exampleSize - 1, deadband),
    even: Math.round(100 / (exampleSize - 1)),
    strong: shareToFactor(1.2, previewParams),
    weak: shareToFactor(0.6, previewParams),
  };
  const negativeSum = scapegoatingIsNegativeSum(exampleSize, previewParams);
  const safeUpTo = maxTeamSizeForNegativeSum(previewParams);

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
        The team factor multiplies the team-scored part of a student&rsquo;s grade. It is worked out from the share of
        the 100 points each student receives, where <strong>1.00 is an even split</strong>: the highest and lowest
        share they were given are dropped, the rest averaged, and the result put through the four settings below.{" "}
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lowest factor" hint="However harshly a student is rated, their factor stops here.">
          <NumberInput className="w-24" min={0.5} max={1} step={0.05} value={floor} onValueChange={setFloor} />
        </Field>
        <Field
          label="Highest factor"
          hint="Keep this nearer 1.00 than the floor. That asymmetry is what makes it unprofitable for a group to agree to mark one member down."
        >
          <NumberInput className="w-24" min={1} max={1.5} step={0.05} value={ceiling} onValueChange={setCeiling} />
        </Field>
        <Field
          label="Dead band (δ)"
          hint="How far from an even split still counts as even. Inside it the factor is exactly 1.00, and students are not asked to justify the allocation."
        >
          <NumberInput className="w-24" min={0} max={0.5} step={0.01} value={deadband} onValueChange={setDeadband} />
        </Field>
        <Field
          label="Damping (k)"
          hint="How much of the deviation beyond the dead band carries through. 0.5 passes on half of it."
        >
          <NumberInput className="w-24" min={0.1} max={1} step={0.05} value={damping} onValueChange={setDamping} />
        </Field>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={includeBehaviors} onChange={(e) => setIncludeBehaviors(e.target.checked)} />
            Include behavior ratings (Part 2)
          </label>
          <p className="mt-1 text-xs text-slate-500">
            Adds Part 2 to the form: each teammate rated 1–5 on the behaviours below. The averages are reported to you
            and back to each student, but never affect the factor.
          </p>
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
            Offer AI contract feedback
          </label>
          <p className="mt-1 text-xs text-slate-500">
            Lets teams ask for feedback on a contract draft. This is the one feature where text (never names) leaves
            the app&rsquo;s encryption, and it only appears if the AI proxy is configured.
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
        <p className="mb-1 font-medium text-slate-700">
          What these settings do, on a team of {exampleSize} — this session&rsquo;s largest
        </p>
        <ul className="space-y-0.5 text-slate-600">
          <li>
            An even split is {preview.even} points each. Anything from <strong>{preview.band.low}</strong> to{" "}
            <strong>{preview.band.high}</strong> still counts as even: factor 1.00, and no justification asked for.
          </li>
          <li>
            A student given about a fifth more than an even share ends on{" "}
            <strong>{preview.strong.toFixed(2)}</strong>; one given little enough to look like a free rider ends on{" "}
            <strong>{preview.weak.toFixed(2)}</strong>.
          </li>
          <li>
            The furthest two teammates can end apart is <strong>{(ceiling - floor).toFixed(2)}</strong>.
          </li>
          <li>
            {negativeSum ? (
              <>
                A group agreeing to mark one member down gains at most{" "}
                <strong>{((exampleSize - 1) * (ceiling - 1)).toFixed(2)}</strong> between them while that member loses{" "}
                <strong>{(1 - floor).toFixed(2)}</strong> — so the play costs the team more than it wins.
              </>
            ) : (
              <>
                On a team this size the {exampleSize - 1} others would gain{" "}
                <strong>{((exampleSize - 1) * (ceiling - 1)).toFixed(2)}</strong> between them while the member they
                mark down loses only <strong>{(1 - floor).toFixed(2)}</strong> — so scapegoating pays.
              </>
            )}
          </li>
        </ul>
        {!negativeSum && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
            {safeUpTo < 2 ? (
              <>These caps do not make scapegoating unprofitable at any team size.</>
            ) : (
              <>
                These caps only make scapegoating unprofitable up to a team of <strong>{safeUpTo}</strong>, and this
                session allows {exampleSize}.
              </>
            )}{" "}
            Lower the highest factor, or lower the floor, to restore that — the arithmetic is (team size &minus; 1)
            &times; (ceiling &minus; 1) &lt; (1 &minus; floor).
          </p>
        )}
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
  const { sid, session } = useSession();
  const params = resolveFactorParams(config);
  const ctx = emailContext(
    session.title,
    surveyUrl(sid),
    { ...params, includeBehaviors: config.includeBehaviors, aiFeedbackEnabled: config.aiFeedbackEnabled },
    CONTRACT_SECTIONS.map((c) => c.title),
  );
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

  async function setEmail(round: EvalRoundId, emailTemplate: string) {
    const next: TeamMgmtConfig = {
      ...config,
      rounds: { ...config.rounds, [round]: { ...config.rounds[round], emailTemplate } },
    };
    // publicTeamMgmt mirrors only status/note/resultsPublished, so the draft
    // stays owner-only.
    await saveTeamMgmt(sid, next, publicTeamMgmt(next));
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
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{ROUND_LABEL[round]}</span>
                <span className="flex items-center gap-1.5">
                  <Badge tone={STATUS_TONE[cfg.status]}>{STATUS_LABEL[cfg.status]}</Badge>
                  {cfg.resultsPublishedAt != null && <Badge tone="green">Results published</Badge>}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {STATUS_ORDER.map((s) => (
                  <Button
                    key={s}
                    variant={cfg.status === s ? "primary" : "secondary"}
                    disabled={busy !== "" || cfg.status === s}
                    onClick={() => setStatus(round, s)}
                  >
                    {STATUS_LABEL[s]}
                  </Button>
                ))}
              </div>
              <NoteEditor initial={cfg.note ?? ""} onSave={(n) => setNote(round, n)} />
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-indigo-700">
                  Email to send students for this round
                </summary>
                <div className="mt-2">
                  <EmailTemplateCard
                    key={`${round}:${cfg.emailTemplate === undefined}`}
                    title={`${ROUND_LABEL[round]} — email to students`}
                    intro={
                      round === "formative"
                        ? "Announces the practice round and explains the form before it counts for anything."
                        : "Announces the graded round and states plainly how the factor is worked out, using this session's settings."
                    }
                    saved={cfg.emailTemplate}
                    fallback={peerEvalEmail(round, ctx)}
                    onSave={(text) => setEmail(round, text)}
                  />
                </div>
              </details>
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
  const dirty = note !== initial;
  return (
    <div className="mt-3">
      <label className="mb-1 block text-xs font-medium text-slate-600">
        Note shown to students on this round
      </label>
      <div className="flex items-center gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="e.g. Closes Friday 5pm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button variant="secondary" onClick={() => onSave(note)} disabled={!dirty}>
          {dirty ? "Save note" : "Saved"}
        </Button>
      </div>
    </div>
  );
}
