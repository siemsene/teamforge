import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "../sessions/SessionContext";
import { updateSession } from "../../lib/db";
import { randomId } from "../../lib/util";
import { syncProjectRequirementsConstraint } from "./autoConstraints";
import type { Constraint, ConstraintWeight, Question } from "../../types";
import { Badge, Button, Card, ErrorText, Field, NumberInput, Select } from "../../components/ui";

const WEIGHT_LABEL: Record<ConstraintWeight, string> = {
  must: "Must hold",
  important: "Important",
  nice: "Nice to have",
};
const WEIGHT_TONE: Record<ConstraintWeight, "red" | "amber" | "gray"> = {
  must: "red",
  important: "amber",
  nice: "gray",
};

export function describeConstraint(c: Constraint, questions: Question[]): string {
  const qText = (id: string) => questions.find((q) => q.id === id)?.prompt ?? "(deleted question)";
  switch (c.kind) {
    case "projectRequirements":
      return "Satisfy every project's attribute requirements";
    case "antiIsolation":
      return `No team has exactly one student with "${c.value}" (${qText(c.questionId)})`;
    case "balanceNumeric":
      return `Balance team averages of "${qText(c.questionId)}"`;
    case "minCapability":
      return `Every team has ≥${c.minCount} student(s) answering ≥${c.threshold} on "${qText(c.questionId)}"`;
    case "minCategory":
      return `Every team has ≥${c.minCount} student(s) answering "${c.value}" (${qText(c.questionId)})`;
    case "alignCategory":
      return `Team members give the same answer to "${qText(c.questionId)}"`;
    case "projectPreference":
      return "Assign students to projects they ranked highly";
    case "teammatePreference":
      return "Place students with the teammates they requested";
  }
}

export function ConstraintsTab() {
  const { sid, session, publicConfig, projects } = useSession();
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState("");
  const constraints = session.constraints;
  const questions = publicConfig.questions;

  // Keep the umbrella project-requirements constraint in sync for existing
  // sessions too (it converges: a write updates session.constraints, the next
  // run finds nothing to change). Project edits also sync it from ProjectsTab.
  useEffect(() => {
    const synced = syncProjectRequirementsConstraint(constraints, projects, session.genericProjects);
    if (synced !== constraints) void updateSession(sid, { constraints: synced });
  }, [constraints, projects, session.genericProjects, sid]);

  // Zero-config "preference" constraints that apply but haven't been added yet.
  const hasRanking = questions.some((q) => q.kind === "projectRanking");
  const hasTeammates = questions.some((q) => q.kind === "teammates");
  const has = (kind: Constraint["kind"]) => constraints.some((c) => c.kind === kind);
  const suggestions: { label: string; make: () => Constraint }[] = [];
  if (hasTeammates && !has("teammatePreference"))
    suggestions.push({
      label: "Respect teammate preferences",
      make: () => ({ id: randomId(8), kind: "teammatePreference", weight: "important" }),
    });
  if (!session.genericProjects && hasRanking && !has("projectPreference"))
    suggestions.push({
      label: "Respect project preferences",
      make: () => ({ id: randomId(8), kind: "projectPreference", weight: "important" }),
    });

  async function persist(next: Constraint[], onOk?: () => void) {
    setActionError("");
    try {
      await updateSession(sid, { constraints: next });
      onOk?.();
    } catch (e) {
      setActionError(`Could not save constraints: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function save(constraint: Constraint) {
    await persist([...constraints, constraint], () => setAdding(false));
  }

  async function remove(id: string) {
    await persist(constraints.filter((c) => c.id !== id));
  }

  async function setWeight(id: string, weight: ConstraintWeight) {
    await persist(constraints.map((c) => (c.id === id ? { ...c, weight } : c)));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          The optimizer minimizes weighted violations: team size limits are always enforced; everything else is
          traded off by weight. To reuse another session's constraints, copy its survey from the Survey tab — the
          questions and the constraints that reference them come across together.
        </p>
        <Button onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "Add constraint"}</Button>
      </div>

      <ErrorText>{actionError}</ErrorText>

      {adding && <ConstraintForm questions={questions} onSave={save} />}

      {suggestions.length > 0 && (
        <Card className="border-indigo-200 bg-indigo-50/40">
          <h3 className="mb-2 text-sm font-semibold">Suggested constraints</h3>
          <p className="mb-3 text-sm text-slate-600">
            Based on your survey questions. Add one with a click, then adjust its weight.
          </p>
          <div className="space-y-2">
            {suggestions.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-700">{s.label}</span>
                <Button variant="secondary" onClick={() => save(s.make())}>
                  Add
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {constraints.length === 0 && !adding && (
        <Card>
          <p className="text-sm text-slate-500">No constraints yet — the optimizer would only balance team sizes.</p>
        </Card>
      )}

      {constraints.map((c) => {
        const managed = c.kind === "projectRequirements";
        return (
          <Card key={c.id}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge tone={WEIGHT_TONE[c.weight]}>{WEIGHT_LABEL[c.weight]}</Badge>
                <span className="text-sm">{describeConstraint(c, questions)}</span>
                {managed && <Badge tone="indigo">from Projects</Badge>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Select value={c.weight} onChange={(e) => setWeight(c.id, e.target.value as ConstraintWeight)}>
                  <option value="must">Must hold</option>
                  <option value="important">Important</option>
                  <option value="nice">Nice to have</option>
                </Select>
                {!managed && (
                  <Button variant="danger" onClick={() => remove(c.id)}>
                    Delete
                  </Button>
                )}
              </div>
            </div>
            {managed && (
              <p className="mt-1 text-xs text-slate-500">
                Reflects the requirements set on the Projects tab — add or remove them there; set how strongly they're
                enforced with the weight here.
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function ConstraintForm({
  questions,
  onSave,
}: {
  questions: Question[];
  onSave: (c: Constraint) => Promise<void>;
}) {
  const [kind, setKind] = useState<Constraint["kind"]>("antiIsolation");
  const [weight, setWeight] = useState<ConstraintWeight>("important");
  const [questionId, setQuestionId] = useState("");
  const [value, setValue] = useState("");
  const [threshold, setThreshold] = useState(4);
  const [minCount, setMinCount] = useState(1);
  const [error, setError] = useState("");

  const categorical = questions.filter((q) => q.kind === "single" || q.kind === "multi");
  // Alignment asks whether members gave the *same* answer, which only means
  // something where each student gives exactly one.
  const singleChoice = questions.filter((q) => q.kind === "single");
  const numeric = questions.filter((q) => q.kind === "number");

  const selectedCategorical = categorical.find((q) => q.id === questionId);
  const options = selectedCategorical && "options" in selectedCategorical ? selectedCategorical.options : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const id = randomId(8);
    let c: Constraint;
    switch (kind) {
      case "antiIsolation":
        if (!questionId || !value) return setError("Pick a question and a value.");
        c = { id, kind, weight, questionId, value };
        break;
      case "balanceNumeric":
        if (!questionId) return setError("Pick a numeric question.");
        c = { id, kind, weight, questionId };
        break;
      case "minCapability":
        if (!questionId) return setError("Pick a numeric question.");
        c = { id, kind, weight, questionId, threshold, minCount };
        break;
      case "minCategory":
        if (!questionId || !value) return setError("Pick a question and an answer.");
        c = { id, kind, weight, questionId, value, minCount };
        break;
      case "alignCategory":
        if (!questionId) return setError("Pick a single-choice question.");
        c = { id, kind, weight, questionId };
        break;
      default:
        return setError("Unsupported constraint type.");
    }
    await onSave(c);
  }

  return (
    <Card className="border-indigo-200">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Constraint type">
            <Select value={kind} onChange={(e) => { setKind(e.target.value as Constraint["kind"]); setQuestionId(""); setValue(""); }} className="w-full">
              <option value="antiIsolation">Anti-isolation (never exactly one …)</option>
              <option value="minCategory">Category coverage (every team needs someone who answered …)</option>
              <option value="minCapability">Capability coverage (every team needs …)</option>
              <option value="alignCategory">Alignment (team members answer alike)</option>
              <option value="balanceNumeric">Balance a numeric attribute</option>
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={weight} onChange={(e) => setWeight(e.target.value as ConstraintWeight)} className="w-full">
              <option value="must">Must hold</option>
              <option value="important">Important</option>
              <option value="nice">Nice to have</option>
            </Select>
          </Field>
        </div>

        {kind === "antiIsolation" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Question">
              <Select value={questionId} onChange={(e) => setQuestionId(e.target.value)} className="w-full">
                <option value="">— select —</option>
                {categorical.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.prompt}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Value that must not be isolated" hint='e.g. "Woman": each team has zero or at least two'>
              <Select value={value} onChange={(e) => setValue(e.target.value)} className="w-full">
                <option value="">— select —</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {kind === "minCategory" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Question">
              <Select value={questionId} onChange={(e) => setQuestionId(e.target.value)} className="w-full">
                <option value="">— select —</option>
                {categorical.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.prompt}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Answer every team needs" hint='e.g. "I prefer to lead"'>
              <Select value={value} onChange={(e) => setValue(e.target.value)} className="w-full">
                <option value="">— select —</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Min per team">
              <NumberInput min={1} value={minCount} onValueChange={setMinCount} />
            </Field>
          </div>
        )}

        {kind === "alignCategory" && (
          <Field
            label="Single-choice question team members should agree on"
            hint="e.g. in person / hybrid / remote — each member outside their team's majority answer costs the weight once"
          >
            <Select value={questionId} onChange={(e) => setQuestionId(e.target.value)} className="w-full">
              <option value="">— select —</option>
              {singleChoice.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.prompt}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {kind === "balanceNumeric" && (
          <Field label="Numeric question to balance">
            <Select value={questionId} onChange={(e) => setQuestionId(e.target.value)} className="w-full">
              <option value="">— select —</option>
              {numeric.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.prompt}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {kind === "minCapability" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Numeric question">
              <Select value={questionId} onChange={(e) => setQuestionId(e.target.value)} className="w-full">
                <option value="">— select —</option>
                {numeric.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.prompt}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Counts as capable if ≥">
              <NumberInput value={threshold} onValueChange={setThreshold} />
            </Field>
            <Field label="Min capable per team">
              <NumberInput min={1} value={minCount} onValueChange={setMinCount} />
            </Field>
          </div>
        )}

        <ErrorText>{error}</ErrorText>
        <Button type="submit">Add constraint</Button>
      </form>
    </Card>
  );
}
