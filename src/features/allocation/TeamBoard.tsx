import { useMemo } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { Evaluation, ViolationDetail } from "../../solver/evaluate";
import type { SolverInput, SolverStudent } from "../../solver/types";
import { Badge, Card, Select } from "../../components/ui";

const UNASSIGNED = "__unassigned__";

const SEVERITY_TONE = { hard: "red", must: "red", important: "amber", nice: "gray" } as const;

export function TeamBoard({
  input,
  assignment,
  evaluation,
  dirty,
  onChange,
}: {
  input: SolverInput;
  assignment: Record<string, string[]>;
  evaluation: Evaluation;
  /** True when the board differs from the allocation last saved. */
  dirty?: boolean;
  onChange: (a: Record<string, string[]>) => void;
}) {
  // KeyboardSensor alongside PointerSensor: this board is the instructor's tool
  // for the last mile of allocation, and drag-only made it unusable without a
  // mouse. Space picks a student up, arrow keys move between teams, Space drops
  // them. The menu on each chip covers the same ground for anyone who would
  // rather not drag at all.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  const byHash = useMemo(() => new Map(input.students.map((s) => [s.hash, s])), [input.students]);

  const assigned = new Set(Object.values(assignment).flat());
  const unassigned = input.students.filter((s) => !assigned.has(s.hash)).map((s) => s.hash);

  function move(studentHash: string, target: string) {
    const next: Record<string, string[]> = {};
    for (const t of input.teams) next[t.id] = (assignment[t.id] ?? []).filter((h) => h !== studentHash);
    if (target !== UNASSIGNED) {
      if (!next[target]) return;
      next[target] = [...next[target], studentHash];
    }
    onChange(next);
  }

  function handleDragEnd(e: DragEndEvent) {
    const target = e.over ? String(e.over.id) : null;
    if (!target) return;
    move(String(e.active.id), target);
  }

  const severityCounts = countBySeverity(evaluation.details);

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <Card>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold">Total penalty: {round1(evaluation.totalPenalty)}</span>
          <SeveritySummary counts={severityCounts} />
          {dirty && <Badge tone="amber">unsaved changes</Badge>}
          <span className="ml-auto text-xs text-slate-500">
            Drag students between teams, or use the menu beside one — violations update live.
          </span>
        </div>
        {dirty && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
            These moves exist only in this browser tab. Press <strong>Save (encrypted)</strong> above — the Teams tab
            builds its roster from the <em>saved</em> allocation, so an unsaved move here would never reach students.
          </p>
        )}
        {(evaluation.byTeam[""] ?? []).map((d, i) => (
          <p key={i} className="mt-1 text-sm text-red-600">
            {d.label}
          </p>
        ))}
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {input.teams.map((team) => {
          const placed = assignment[team.id] ?? [];
          const members = placed.map((h) => byHash.get(h)).filter((s): s is SolverStudent => !!s);
          // A hash the allocation still places for a student who has since been
          // removed resolves to nobody. Count what is actually shown, and say
          // that the rest are gone — the count used to include them, so a card
          // read "5 members" above four chips with nothing to explain it.
          const gone = placed.length - members.length;
          return (
            <TeamCard
              key={team.id}
              id={team.id}
              title={team.name}
              subtitle={
                `${members.length} members (${team.minSize}–${team.maxSize}, ideal ${input.idealTeamSize})` +
                (gone > 0 ? ` · ${gone} removed from the session` : "")
              }
              members={members}
              violations={evaluation.byTeam[team.id] ?? []}
              input={input}
              onMove={move}
            />
          );
        })}
        {unassigned.length > 0 && (
          <TeamCard
            id={UNASSIGNED}
            title="Unassigned"
            subtitle="Move each onto a team"
            members={unassigned.map((h) => byHash.get(h)).filter((s): s is SolverStudent => !!s)}
            violations={[]}
            input={input}
            onMove={move}
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
  onMove,
  danger,
}: {
  id: string;
  title: string;
  subtitle: string;
  members: SolverStudent[];
  violations: ViolationDetail[];
  input: SolverInput;
  onMove: (studentHash: string, target: string) => void;
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
          <StudentChip key={s.hash} student={s} input={input} currentTeamId={id} onMove={onMove} />
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

function StudentChip({
  student,
  input,
  currentTeamId,
  onMove,
}: {
  student: SolverStudent;
  input: SolverInput;
  currentTeamId: string;
  onMove: (studentHash: string, target: string) => void;
}) {
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
    <span className="inline-flex items-stretch">
      <span
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        title={summary}
        aria-label={`Student #${student.codeIndex}`}
        aria-roledescription="draggable student"
        style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
        className={`cursor-grab touch-none select-none rounded-l-md px-2 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
          isDragging ? "z-10 bg-indigo-600 text-white shadow-lg" : student.submitted ? "bg-indigo-100 text-indigo-800" : "bg-slate-200 text-slate-500"
        }`}
      >
        #{student.codeIndex}
      </span>
      {/* The same move without the drag. Cheap to offer, and the only route for
          anyone on a screen reader or a device where dragging is awkward. */}
      <Select
        aria-label={`Move student #${student.codeIndex} to another team`}
        value={currentTeamId}
        onChange={(e) => onMove(student.hash, e.target.value)}
        className="rounded-l-none border-l-0 px-1 py-0 text-xs"
      >
        {input.teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
        <option value={UNASSIGNED}>Unassigned</option>
      </Select>
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
