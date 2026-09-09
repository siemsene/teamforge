import { useEffect, useState } from "react";
import { ConfirmDialog, ErrorText, Field, Input, Select } from "../../components/ui";
import { CONSEQUENCE_TEXT, type RemovalConsequence } from "../completion/rosterEdit";
import { normalizeLabel, TEAM_EDIT_WARNING_TEXT, type TeamEditWarning } from "./teamEdit";

const NEW_TEAM = "__new__";

/** A member as the dialogs name them: "Ada (#7)" or "#7". */
export interface MemberRef {
  codeHash: string;
  codeIndex: number;
  name: string;
}

function Warnings({ warnings }: { warnings: TeamEditWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <>
      {warnings.map((w) => (
        <p key={w}>{TEAM_EDIT_WARNING_TEXT[w]}</p>
      ))}
    </>
  );
}

/**
 * Pick an existing team or name a new one. The value handed back is the label
 * as it will be stored, or "" while nothing valid is chosen.
 */
function TeamPicker({
  labels,
  exclude,
  choice,
  newLabel,
  onChoice,
  onNewLabel,
}: {
  labels: string[];
  exclude?: string;
  choice: string;
  newLabel: string;
  onChoice: (v: string) => void;
  onNewLabel: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Field label="Team">
        <Select value={choice} onChange={(e) => onChoice(e.target.value)} className="w-full">
          <option value="">Choose a team…</option>
          {labels
            .filter((l) => l !== exclude)
            .map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          <option value={NEW_TEAM}>New team…</option>
        </Select>
      </Field>
      {choice === NEW_TEAM && (
        <Field label="Name of the new team" hint="A name that matches an existing team joins that team instead.">
          <Input value={newLabel} onChange={(e) => onNewLabel(e.target.value)} placeholder="e.g. Team 7" autoFocus />
        </Field>
      )}
    </div>
  );
}

function useTeamChoice(open: boolean, initial?: string) {
  const [choice, setChoice] = useState(initial ?? "");
  const [newLabel, setNewLabel] = useState("");
  useEffect(() => {
    if (open) {
      setChoice(initial ?? "");
      setNewLabel("");
    }
  }, [open, initial]);
  const label = choice === NEW_TEAM ? normalizeLabel(newLabel) : choice;
  return { choice, setChoice, newLabel, setNewLabel, label };
}

export function MoveMemberDialog({
  open,
  member,
  fromLabel,
  labels,
  warningsFor,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  member: MemberRef;
  fromLabel: string;
  labels: string[];
  warningsFor: (toLabel: string) => TeamEditWarning[];
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (toLabel: string) => void;
}) {
  const t = useTeamChoice(open);
  const [problem, setProblem] = useState("");
  return (
    <ConfirmDialog
      open={open}
      title={`Move ${member.name} from ${fromLabel}`}
      confirmLabel="Move"
      tone="primary"
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => {
        if (!t.label) return setProblem(t.choice === NEW_TEAM ? "Give the new team a name." : "Choose a team.");
        setProblem("");
        onConfirm(t.label);
      }}
    >
      <TeamPicker
        labels={labels}
        exclude={fromLabel}
        choice={t.choice}
        newLabel={t.newLabel}
        onChoice={t.setChoice}
        onNewLabel={t.setNewLabel}
      />
      <p>
        Their teammates on both teams see the change the next time they load the page; the student sees their new
        team, contract and teammates on their next login.
      </p>
      {t.label && <Warnings warnings={warningsFor(t.label)} />}
      <ErrorText>{problem || error}</ErrorText>
    </ConfirmDialog>
  );
}

export function RemoveMemberDialog({
  open,
  member,
  consequences,
  warnings,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  member: MemberRef;
  consequences: RemovalConsequence[];
  warnings: TeamEditWarning[];
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title={`Remove ${member.name} from the session?`}
      confirmLabel="Remove"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p>
        This deletes #{member.codeIndex} for good. Their login code stops working at once and cannot be reissued,
        and their number is retired — anyone you add later gets a new one. Their teammates stop seeing them on the
        contract and the peer-evaluation form as soon as this finishes. This cannot be undone.
      </p>
      {consequences
        .filter((c) => c !== "teamKeyRetained" && c !== "provisionedTeam")
        .map((c) => (
          <p key={c}>{CONSEQUENCE_TEXT[c]}</p>
        ))}
      <Warnings warnings={warnings} />
      {consequences.includes("teamKeyRetained") && (
        <>
          <p className="font-medium">What removing does not do</p>
          <p>{CONSEQUENCE_TEXT.teamKeyRetained}</p>
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </ConfirmDialog>
  );
}

export type AddStudentChoice = { mode: "mint" } | { mode: "code"; code: string };

/**
 * Add a student to a team. Two ways in:
 *
 *   - mint a new login code, for someone who is new to the session altogether;
 *   - type an existing code, for someone already on the roster but on no team
 *     (added on the Roster tab after provisioning). When the dialog is opened
 *     for a specific such student, only this way is offered.
 */
export function AddStudentDialog({
  open,
  labels,
  initialLabel,
  student,
  warningsFor,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  labels: string[];
  initialLabel?: string;
  /** Set when placing a known student who has no team yet. */
  student?: { codeIndex: number };
  warningsFor: (toLabel: string) => TeamEditWarning[];
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (choice: AddStudentChoice, toLabel: string) => void;
}) {
  const t = useTeamChoice(open, initialLabel);
  const [mode, setMode] = useState<"mint" | "code">(student ? "code" : "mint");
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState("");
  useEffect(() => {
    if (open) {
      setMode(student ? "code" : "mint");
      setCode("");
      setProblem("");
    }
  }, [open, student]);

  return (
    <ConfirmDialog
      open={open}
      title={student ? `Place #${student.codeIndex} on a team` : "Add a student to a team"}
      confirmLabel={busy ? "Working…" : mode === "mint" ? "Add and download their code" : "Place on team"}
      tone="primary"
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => {
        if (!t.label) return setProblem(t.choice === NEW_TEAM ? "Give the new team a name." : "Choose a team.");
        if (mode === "code" && !code.trim()) return setProblem("Type the student's login code.");
        setProblem("");
        onConfirm(mode === "mint" ? { mode: "mint" } : { mode: "code", code: code.trim() }, t.label);
      }}
    >
      {!student && (
        <div className="flex flex-col gap-1">
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={mode === "mint"} onChange={() => setMode("mint")} />
            <span>
              <span className="font-medium">New to the session.</span> A login code is minted for them and downloaded
              as a one-row CSV, exactly as on the Roster tab, and they are placed on the team in the same step — no
              re-upload.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={mode === "code"} onChange={() => setMode("code")} />
            <span>
              <span className="font-medium">Already has a login code</span> but is on no team. Type their code from
              your codes CSV; it is used once, in this browser, to derive their key.
            </span>
          </label>
        </div>
      )}
      {mode === "code" && (
        <Field label="Login code" hint="From your codes CSV. Dashes and case do not matter.">
          <Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
      )}
      <TeamPicker labels={labels} choice={t.choice} newLabel={t.newLabel} onChoice={t.setChoice} onNewLabel={t.setNewLabel} />
      {t.label && <Warnings warnings={warningsFor(t.label)} />}
      <ErrorText>{problem || error}</ErrorText>
    </ConfirmDialog>
  );
}

export function DeleteTeamDialog({
  open,
  label,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  label: string;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title={`Delete ${label}?`}
      confirmLabel="Delete team"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p>
        This team has no members. Deleting it removes its document — the contract it held and any display names
        chosen there — for good. Its former members already have their new teams; nothing changes for them.
      </p>
      <ErrorText>{error}</ErrorText>
    </ConfirmDialog>
  );
}
