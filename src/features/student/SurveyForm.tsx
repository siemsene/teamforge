import { useState, type FormEvent } from "react";
import { normalizeCode } from "../../lib/codes";
import type { ProjectRankingQuestion, PublicConfig, Question, SurveyAnswers, TeammatesQuestion } from "../../types";
import { Button, Card, ErrorText, Select } from "../../components/ui";

export function SurveyForm({
  config,
  busy,
  onSubmit,
}: {
  config: PublicConfig;
  busy: boolean;
  onSubmit: (answers: SurveyAnswers) => void;
}) {
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [error, setError] = useState("");

  function setAnswer(id: string, value: number | string | string[]) {
    setAnswers((a) => ({ ...a, [id]: value }));
  }

  function validate(): string | null {
    for (const q of config.questions) {
      const v = answers[q.id];
      if (!q.required) continue;
      if (q.kind === "projectRanking") {
        const ranked = (v as string[] | undefined) ?? [];
        if (ranked.filter(Boolean).length < q.rankCount)
          return `Please rank ${q.rankCount} projects ("${q.prompt}").`;
        continue;
      }
      if (q.kind === "teammates") continue; // always optional in spirit
      if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0))
        return `Please answer: "${q.prompt}"`;
    }
    return null;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    // Strip empty teammate codes and normalize them for matching.
    const cleaned: SurveyAnswers = { ...answers };
    for (const q of config.questions) {
      if (q.kind === "teammates") {
        const codes = ((cleaned[q.id] as string[] | undefined) ?? []).map(normalizeCode).filter((c) => c.length > 0);
        cleaned[q.id] = codes;
      }
    }
    onSubmit(cleaned);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {config.questions.map((q, i) => (
        <Card key={q.id}>
          <p className="mb-2 font-medium">
            {i + 1}. {q.prompt}
            {q.required && q.kind !== "teammates" && <span className="text-red-500"> *</span>}
          </p>
          <QuestionInput q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} config={config} />
        </Card>
      ))}
      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Encrypting and submitting…" : "Submit (encrypted)"}
      </Button>
    </form>
  );
}

function QuestionInput({
  q,
  value,
  onChange,
  config,
}: {
  q: Question;
  value: number | string | string[] | undefined;
  onChange: (v: number | string | string[]) => void;
  config: PublicConfig;
}) {
  if (q.kind === "number") {
    const current = typeof value === "number" ? value : undefined;
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`h-9 w-9 rounded-md border text-sm font-medium ${
              current === n ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white hover:bg-slate-50"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    );
  }

  if (q.kind === "single") {
    return (
      <div className="space-y-1">
        {q.options.map((opt) => (
          <label key={opt} className="flex items-center gap-2 text-sm">
            <input type="radio" name={q.id} checked={value === opt} onChange={() => onChange(opt)} />
            {opt}
          </label>
        ))}
      </div>
    );
  }

  if (q.kind === "multi") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-1">
        {q.options.map((opt) => (
          <label key={opt} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              onChange={(e) =>
                onChange(e.target.checked ? [...selected, opt] : selected.filter((s) => s !== opt))
              }
            />
            {opt}
          </label>
        ))}
      </div>
    );
  }

  if (q.kind === "projectRanking") return <ProjectRankingInput q={q} value={value} onChange={onChange} config={config} />;

  return <TeammatesInput q={q} value={value} onChange={onChange} />;
}

function ProjectRankingInput({
  q,
  value,
  onChange,
  config,
}: {
  q: ProjectRankingQuestion;
  value: number | string | string[] | undefined;
  onChange: (v: string[]) => void;
  config: PublicConfig;
}) {
  const ranked = Array.isArray(value) ? value : Array<string>(q.rankCount).fill("");

  function setRank(i: number, pid: string) {
    const next = [...ranked];
    // A project can hold only one rank.
    for (let j = 0; j < next.length; j++) if (next[j] === pid) next[j] = "";
    next[i] = pid;
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-md bg-slate-50 p-3">
        {config.projects.map((p) => (
          <details key={p.id} className="text-sm">
            <summary className="cursor-pointer font-medium">{p.name}</summary>
            <p className="mt-1 whitespace-pre-wrap text-slate-600">{p.description || "No description."}</p>
          </details>
        ))}
      </div>
      {Array.from({ length: q.rankCount }, (_, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="w-24 text-slate-600">Choice {i + 1}:</span>
          <Select value={ranked[i] ?? ""} onChange={(e) => setRank(i, e.target.value)} className="flex-1">
            <option value="">— select a project —</option>
            {config.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      ))}
    </div>
  );
}

function TeammatesInput({
  q,
  value,
  onChange,
}: {
  q: TeammatesQuestion;
  value: number | string | string[] | undefined;
  onChange: (v: string[]) => void;
}) {
  const codes = Array.isArray(value) ? value : Array<string>(q.maxCodes).fill("");
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Optional. Enter the login codes of classmates you'd like to team up with (ask them for their code). Leave
        blank if no preference.
      </p>
      {Array.from({ length: q.maxCodes }, (_, i) => (
        <input
          key={i}
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm uppercase focus:border-indigo-500 focus:outline-none sm:w-56"
          placeholder="XXXXX-XXXXX"
          value={codes[i] ?? ""}
          onChange={(e) => {
            const next = [...codes];
            next[i] = e.target.value;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}
