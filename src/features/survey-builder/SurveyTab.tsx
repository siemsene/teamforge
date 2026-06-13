import { useState, type FormEvent } from "react";
import { useSession } from "../sessions/SessionContext";
import { updatePublicConfig } from "../../lib/db";
import { randomId } from "../../lib/util";
import type { Question, QuestionKind } from "../../types";
import { Badge, Button, Card, ErrorText, Field, Input, NumberInput, Select } from "../../components/ui";

const KIND_LABELS: Record<QuestionKind, string> = {
  number: "Numeric (scale)",
  single: "Single choice",
  multi: "Multiple choice",
  projectRanking: "Project ranking",
  teammates: "Preferred teammates",
};

export function SurveyTab() {
  const { sid, session, publicConfig } = useSession();
  const questions = publicConfig.questions;
  const [editing, setEditing] = useState<Question | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function save(question: Question) {
    const exists = questions.some((q) => q.id === question.id);
    const updated = exists ? questions.map((q) => (q.id === question.id ? question : q)) : [...questions, question];
    await updatePublicConfig(sid, { questions: updated });
    setEditing(null);
    setShowForm(false);
  }

  async function remove(id: string) {
    const q = questions.find((x) => x.id === id);
    if (q?.auto && q.kind === "single") {
      window.alert("This question was generated from project requirements. Remove the requirements first.");
      return;
    }
    if (!window.confirm("Delete this question?")) return;
    await updatePublicConfig(sid, { questions: questions.filter((x) => x.id !== id) });
  }

  async function move(id: string, dir: -1 | 1) {
    const i = questions.findIndex((q) => q.id === id);
    const j = i + dir;
    if (j < 0 || j >= questions.length) return;
    const updated = [...questions];
    [updated[i], updated[j]] = [updated[j], updated[i]];
    await updatePublicConfig(sid, { questions: updated });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Questions marked <Badge tone="indigo">auto</Badge> were generated from project requirements. Add your own
          for demographics, capabilities, and preferences.
        </p>
        <Button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          Add question
        </Button>
      </div>

      {showForm && (
        <QuestionForm
          key={editing?.id ?? "new"}
          initial={editing}
          hasTeammatesQuestion={questions.some((q) => q.kind === "teammates" && q.id !== editing?.id)}
          onSave={save}
          onCancel={() => {
            setEditing(null);
            setShowForm(false);
          }}
        />
      )}

      {questions.length === 0 && !showForm && (
        <Card>
          <p className="text-sm text-slate-500">
            No questions yet. {session.genericProjects ? "" : "Add projects with requirements, or "}add custom
            questions here.
          </p>
        </Card>
      )}

      {questions.map((q, i) => (
        <Card key={q.id}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{q.prompt}</span>
                {q.auto && <Badge tone="indigo">auto</Badge>}
                {q.required && <Badge tone="gray">required</Badge>}
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {KIND_LABELS[q.kind]}
                {q.kind === "number" && ` · ${q.min}–${q.max}`}
                {(q.kind === "single" || q.kind === "multi") && ` · ${q.options.join(", ")}`}
                {q.kind === "projectRanking" && ` · rank top ${q.rankCount}`}
                {q.kind === "teammates" && ` · up to ${q.maxCodes} codes`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" onClick={() => move(q.id, -1)} disabled={i === 0}>
                ↑
              </Button>
              <Button variant="ghost" onClick={() => move(q.id, 1)} disabled={i === questions.length - 1}>
                ↓
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(q);
                  setShowForm(true);
                }}
              >
                Edit
              </Button>
              <Button variant="danger" onClick={() => remove(q.id)}>
                Delete
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function QuestionForm({
  initial,
  hasTeammatesQuestion,
  onSave,
  onCancel,
}: {
  initial: Question | null;
  hasTeammatesQuestion: boolean;
  onSave: (q: Question) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<QuestionKind>(initial?.kind ?? "single");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [required, setRequired] = useState(initial?.required ?? true);
  const [options, setOptions] = useState(
    initial && (initial.kind === "single" || initial.kind === "multi") ? initial.options.join("\n") : "",
  );
  const [min, setMin] = useState(initial?.kind === "number" ? initial.min : 1);
  const [max, setMax] = useState(initial?.kind === "number" ? initial.max : 5);
  const [rankCount, setRankCount] = useState(initial?.kind === "projectRanking" ? initial.rankCount : 3);
  const [maxCodes, setMaxCodes] = useState(initial?.kind === "teammates" ? initial.maxCodes : 3);
  const [error, setError] = useState("");

  const isAutoSingle = !!initial?.auto && initial.kind === "single";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!prompt.trim()) return setError("Question text is required.");
    const id = initial?.id ?? randomId(8);
    const base = { id, prompt: prompt.trim(), required, auto: initial?.auto, attributeKey: initial?.attributeKey };

    let q: Question;
    if (kind === "number") {
      if (min >= max) return setError("Min must be below max.");
      q = { ...base, kind, min, max };
    } else if (kind === "single" || kind === "multi") {
      const opts = options
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (opts.length < 2) return setError("Provide at least two options (one per line).");
      q = { ...base, kind, options: opts };
    } else if (kind === "projectRanking") {
      q = { ...base, kind, rankCount: Math.max(1, rankCount) };
    } else {
      if (hasTeammatesQuestion) return setError("There is already a preferred-teammates question.");
      q = { ...base, kind, maxCodes: Math.max(1, maxCodes) };
    }
    await onSave(q);
  }

  return (
    <Card className="border-indigo-200">
      <form onSubmit={submit} className="space-y-3">
        <h3 className="font-semibold">{initial ? "Edit question" : "New question"}</h3>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Question text">
            <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="How would you rate your coding skills?" />
          </Field>
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as QuestionKind)} disabled={!!initial}>
              <option value="single">Single choice</option>
              <option value="multi">Multiple choice</option>
              <option value="number">Numeric scale</option>
              <option value="teammates">Preferred teammates</option>
            </Select>
          </Field>
        </div>
        {(kind === "single" || kind === "multi") && (
          <Field
            label="Options (one per line)"
            hint={isAutoSingle ? "Options coming from project requirements cannot be removed here." : undefined}
          >
            <textarea
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              rows={4}
              value={options}
              onChange={(e) => setOptions(e.target.value)}
            />
          </Field>
        )}
        {kind === "number" && (
          <div className="flex gap-3">
            <Field label="Min">
              <NumberInput className="w-24" value={min} onValueChange={setMin} />
            </Field>
            <Field label="Max">
              <NumberInput className="w-24" value={max} onValueChange={setMax} />
            </Field>
          </div>
        )}
        {kind === "projectRanking" && (
          <Field label="How many projects must students rank?">
            <NumberInput className="w-24" min={1} value={rankCount} onValueChange={setRankCount} />
          </Field>
        )}
        {kind === "teammates" && (
          <Field
            label="Max teammate codes"
            hint="Students list login codes of classmates they want to work with (they exchange codes themselves)."
          >
            <NumberInput className="w-24" min={1} max={10} value={maxCodes} onValueChange={setMaxCodes} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Required
        </label>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit">Save question</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
