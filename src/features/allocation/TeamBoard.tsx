import { useMemo } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import type { Evaluation, ViolationDetail } from "../../solver/evaluate";
import type { SolverInput, SolverStudent } from "../../solver/types";
import { Badge, Card } from "../../components/ui";

const UNASSIGNED = "__unassigned__";

const SEVERITY_TONE = { hard: "red", must: "red", important: "amber", nice: "gray" } as const;

export function TeamBoard({
  input,
  assignment,
  evaluation,
  onChange,
}: {
  input: SolverInput;
  assignment: Record<string, string[]>;
  evaluation: Evaluation;
  onChange: (a: Record<string, string[]>) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const byHash = useMemo(() => new Map(input.students.map((s) => [s.hash, s])), [input.students]);

  const assigned = new Set(Object.values(assignment).flat());
  const unassigned = input.students.filter((s) => !assigned.has(s.hash)).map((s) => s.hash);

  function handleDragEnd(e: DragEndEvent) {
    const studentHash = String(e.active.id);
    const target = e.over ? String(e.over.id) : null;
    if (!target) return;
    const next: Record<string, string[]> = {};
    for (const t of input.teams) next[t.id] = (assignment[t.id] ?? []).filter((h) => h !== studentHash);
    if (target !== UNASSIGNED) {
      if (!next[target]) return;
      next[target] = [...next[target], studentHash];
    }
    onChange(next);
  }

  const severityCounts = countBySeverity(evaluation.details);

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <Card>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold">Total penalty: {round1(evaluation.totalPenalty)}</span>
          <SeveritySummary counts={severityCounts} />
          <span className="ml-auto text-xs text-slate-500">
            Drag students between teams — violations update live.
          </span>
        </div>
        {(evaluation.byTeam[""] ?? []).map((d, i) => (
          <p key={i} className="mt-1 text-sm text-red-600">
            {d.label}
          </p>
        ))}
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {input.teams.map((team) => (
          <TeamCard
            key={team.id}
            id={team.id}
            title={team.name}
            subtitle={`${(assignment[team.id] ?? []).length} members (${team.minSize}–${team.maxSize}, ideal ${input.idealTeamSize})`}
            members={(assignment[team.id] ?? []).map((h) => byHash.get(h)).filter((s): s is SolverStudent => !!s)}
            violations={evaluation.byTeam[team.id] ?? []}
            input={input}
          />
        ))}
        {unassigned.length > 0 && (
          <TeamCard
            id={UNASSIGNED}
            title="Unassigned"
            subtitle="Drag students onto a team"
            members={unassigned.map((h) => byHash.get(h)).filter((s): s is SolverStudent => !!s)}
            violations={[]}
            input={input}
            danger
          />
        )}
      </div>
    </DndContext>
  );
}

function TeamCard({
  id,
  title,
  subtitle,
  members,
  violations,
  input,
  danger,
}: {
  id: string;
  title: string;
  subtitle: string;
  members: SolverStudent[];
  violations: ViolationDetail[];
  input: SolverInput;
  danger?: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  const worst = violations.some((v) => v.severity === "hard" || v.severity === "must")
    ? "border-red-300"
    : violations.some((v) => v.severity === "important")
      ? "border-amber-300"
      : "border-slate-200";

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border bg-white p-3 shadow-sm transition-colors ${danger ? "border-red-300 bg-red-50" : worst} ${
        isOver ? "ring-2 ring-indigo-400" : ""
      }`}
    >
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-xs text-slate-500">{subtitle}</span>
      </div>
      <div className="mb-2 flex min-h-10 flex-wrap gap-1.5">
        {members.map((s) => (
          <StudentChip key={s.hash} student={s} input={input} />
        ))}
        {members.length === 0 && <span className="text-xs text-slate-400">empty</span>}
      </div>
      {violations.length > 0 && (
        <ul className="space-y-1 border-t border-slate-100 pt-2">
          {violations.map((v, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
              <Badge tone={SEVERITY_TONE[v.severity]}>{v.severity}</Badge>
              <span>{v.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StudentChip({ student, input }: { student: SolverStudent; input: SolverInput }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: student.hash });
  const summary = useMemo(() => {
    const parts: string[] = [];
    for (const q of input.questions) {
      const v = student.answers[q.id];
      if (v === undefined || q.kind === "teammates" || q.kind === "projectRanking") continue;
      parts.push(`${q.prompt}: ${Array.isArray(v) ? v.join("/") : v}`);
    }
    return parts.length ? parts.join("\n") : "No survey response";
  }, [student, input.questions]);

  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={summary}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={`cursor-grab touch-none select-none rounded-md px-2 py-1 text-xs font-medium ${
        isDragging ? "z-10 bg-indigo-600 text-white shadow-lg" : student.submitted ? "bg-indigo-100 text-indigo-800" : "bg-slate-200 text-slate-500"
      }`}
    >
      #{student.codeIndex}
    </span>
  );
}

function SeveritySummary({ counts }: { counts: Record<string, number> }) {
  return (
    <span className="flex gap-2">
      {(["hard", "must", "important", "nice"] as const).map((sev) =>
        counts[sev] ? (
          <Badge key={sev} tone={SEVERITY_TONE[sev]}>
            {counts[sev]} {sev === "hard" ? "hard violations" : sev}
          </Badge>
        ) : null,
      )}
    </span>
  );
}

function countBySeverity(details: ViolationDetail[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const d of details) counts[d.severity] = (counts[d.severity] ?? 0) + 1;
  return counts;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
