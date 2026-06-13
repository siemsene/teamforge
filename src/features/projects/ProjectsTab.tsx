import { useState, type FormEvent } from "react";
import { useSession } from "../sessions/SessionContext";
import { deleteProject, saveProject, updatePublicConfig, updateSession } from "../../lib/db";
import { syncAutoQuestions, slugify } from "../survey-builder/autoQuestions";
import { syncProjectRequirementsConstraint } from "../constraints/autoConstraints";
import { randomId } from "../../lib/util";
import type { Project, ProjectRequirement } from "../../types";
import { Badge, Button, Card, ErrorText, Field, Input, NumberInput, TextArea } from "../../components/ui";

export function ProjectsTab() {
  const { sid, session, projects, publicConfig } = useSession();
  const [editing, setEditing] = useState<Project | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Persisting a project also refreshes the student-facing mirror: project
  // blurbs and auto-generated survey questions.
  async function persist(updatedProjects: Project[]) {
    await updatePublicConfig(sid, {
      projects: updatedProjects.map((p) => ({ id: p.id, name: p.name, description: p.description })),
      questions: syncAutoQuestions(publicConfig.questions, updatedProjects, session.genericProjects),
    });
    // Keep the umbrella project-requirements constraint in step with the
    // requirements just defined, so it shows up (weightable) on the Constraints tab.
    const constraints = syncProjectRequirementsConstraint(session.constraints, updatedProjects, session.genericProjects);
    if (constraints !== session.constraints) await updateSession(sid, { constraints });
  }

  async function save(project: Project) {
    await saveProject(sid, project);
    const updated = projects.filter((p) => p.id !== project.id).concat(project);
    await persist(updated);
    setEditing(null);
    setShowForm(false);
  }

  async function remove(pid: string) {
    if (!window.confirm("Delete this project?")) return;
    await deleteProject(sid, pid);
    await persist(projects.filter((p) => p.id !== pid));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          One team is formed per project. Requirements automatically add matching questions to the student survey.
        </p>
        <Button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          Add project
        </Button>
      </div>

      {showForm && (
        <ProjectForm
          key={editing?.id ?? "new"}
          initial={editing}
          onSave={save}
          onCancel={() => {
            setEditing(null);
            setShowForm(false);
          }}
        />
      )}

      {projects.length === 0 && !showForm && (
        <Card>
          <p className="text-sm text-slate-500">No projects yet.</p>
        </Card>
      )}

      {projects.map((p) => (
        <Card key={p.id}>
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold">{p.name}</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{p.description}</p>
              {p.requirements.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.requirements.map((r, i) => (
                    <Badge key={i} tone="indigo">
                      ≥{r.minCount} × {r.attributeLabel} = {r.value}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(p);
                  setShowForm(true);
                }}
              >
                Edit
              </Button>
              <Button variant="danger" onClick={() => remove(p.id)}>
                Delete
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ProjectForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Project | null;
  onSave: (p: Project) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [requirements, setRequirements] = useState<ProjectRequirement[]>(initial?.requirements ?? []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function setReq(i: number, patch: Partial<ProjectRequirement>) {
    setRequirements((reqs) => reqs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Project name is required.");
    for (const r of requirements) {
      if (!r.attributeLabel.trim() || !r.value.trim()) return setError("Each requirement needs an attribute and a value.");
      if (r.minCount < 1) return setError("Requirement counts must be at least 1.");
    }
    setBusy(true);
    try {
      await onSave({
        id: initial?.id ?? randomId(8),
        name: name.trim(),
        description: description.trim(),
        requirements: requirements.map((r) => ({ ...r, attributeKey: slugify(r.attributeLabel) })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Card className="border-indigo-200">
      <form onSubmit={submit} className="space-y-3">
        <h3 className="font-semibold">{initial ? "Edit project" : "New project"}</h3>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Description (shown to students)">
          <TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Requirements</span>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRequirements((r) => [...r, { attributeKey: "", attributeLabel: "", value: "", minCount: 1 }])}
            >
              + Add requirement
            </Button>
          </div>
          {requirements.length === 0 && (
            <p className="text-xs text-slate-500">
              e.g. attribute “Major”, value “Computer Science”, count 1 → “this project needs at least one CS major”.
            </p>
          )}
          {requirements.map((r, i) => (
            <div key={i} className="mb-2 flex items-end gap-2">
              <Field label="Attribute">
                <Input
                  value={r.attributeLabel}
                  placeholder="Major"
                  onChange={(e) => setReq(i, { attributeLabel: e.target.value })}
                />
              </Field>
              <Field label="Required value">
                <Input value={r.value} placeholder="Computer Science" onChange={(e) => setReq(i, { value: e.target.value })} />
              </Field>
              <Field label="Min count">
                <NumberInput
                  min={1}
                  className="w-20"
                  value={r.minCount}
                  onValueChange={(n) => setReq(i, { minCount: n })}
                />
              </Field>
              <Button type="button" variant="ghost" onClick={() => setRequirements((reqs) => reqs.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
          ))}
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Save project
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
