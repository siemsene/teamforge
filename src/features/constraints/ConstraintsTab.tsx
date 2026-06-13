import { useState, type FormEvent } from "react";
import { useSession } from "../sessions/SessionContext";
import { updateSession } from "../../lib/db";
import { randomId } from "../../lib/util";
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
    case "projectPreference":
      return "Assign students to projects they ranked highly";
    case "teammatePreference":
      return "Place students with the teammates they requested";
  }
}

export function ConstraintsTab() {
  const { sid, session, publicConfig } = useSession();
  const [adding, setAdding] = useState(false);
  const constraints = session.constraints;
  const questions = publicConfig.questions;

  async function save(constraint: Constraint) {
    await updateSession(sid, { constraints: [...constraints, constraint] });
    setAdding(false);
  }

  async function remove(id: string) {
    await updateSession(sid, { constraints: constraints.filter((c) => c.id !== id) });
  }

  async function setWeight(id: string, weight: ConstraintWeight) {
    await updateSession(sid, {
      constraints: constraints.map((c) => (c.id === id ? { ...c, weight } : c)),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          The optimizer minimizes weighted violations: team size limits are always enforced; everything else is
          traded off by weight.
        </p>
        <Button onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "Add constraint"}</Button>
      </div>

      {adding && <ConstraintForm questions={questions} genericProjects={session.genericProjects} onSave={save} />}

      {constraints.length === 0 && !adding && (
        <Card>
          <p className="text-sm text-slate-500">No constraints yet — the optimizer would only balance team sizes.</p>
        </Card>
      )}

      {constraints.map((c) => (
        <Card key={c.id}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge tone={WEIGHT_TONE[c.weight]}>{WEIGHT_LABEL[c.weight]}</Badge>
              <span className="text-sm">{describeConstraint(c, questions)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Select value={c.weight} onChange={(e) => setWeight(c.id, e.target.value as ConstraintWeight)}>
                <option value="must">Must hold</option>
                <option value="important">Important</option>
                <option value="nice">Nice to have</option>
              </Select>
              <Button variant="danger" onClick={() => remove(c.id)}>
                Delete
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ConstraintForm({
  questions,
  genericProjects,
  onSave,
}: {
  questions: Question[];
  genericProjects: boolean;
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
  const numeric = questions.filter((q) => q.kind === "number");
  const hasRanking = questions.some((q) => q.kind === "projectRanking");
  const hasTeammates = questions.some((q) => q.kind === "teammates");

  const selectedCategorical = categorical.find((q) => q.id === questionId);
  const options = selectedCategorical && "options" in selectedCategorical ? selectedCategorical.options : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const id = randomId(8);
    let c: Constraint;
    switch (kind) {
      case "projectRequirements":
        c = { id, kind, weight };
        break;
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
      case "projectPreference":
      case "teammatePreference":
        c = { id, kind, weight };
        break;
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
              <option value="minCapability">Capability coverage (every team needs …)</option>
              <option value="balanceNumeric">Balance a numeric attribute</option>
              {!genericProjects && <option value="projectRequirements">Enforce project requirements</option>}
              {!genericProjects && hasRanking && <option value="projectPreference">Respect project preferences</option>}
              {hasTeammates && <option value="teammatePreference">Respect teammate preferences</option>}
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

        {kind === "projectRequirements" && (
          <p className="text-sm text-slate-600">
            Each project's attribute requirements (from the Projects tab) become team constraints.
          </p>
        )}
        {kind === "projectPreference" && (
          <p className="text-sm text-slate-600">Penalizes assigning students to projects they ranked low or not at all.</p>
        )}
        {kind === "teammatePreference" && (
          <p className="text-sm text-slate-600">Rewards placing students with at least one classmate they listed.</p>
        )}

        <ErrorText>{error}</ErrorText>
        <Button type="submit">Add constraint</Button>
      </form>
    </Card>
  );
}
