import { useEffect, useMemo, useState } from "react";
import { useSession } from "../sessions/SessionContext";
import { getAllocationDoc, removeStudents } from "../../lib/db";
import { downloadFile } from "../../lib/util";
import { CONSEQUENCE_TEXT, nextCodeIndex, removalConsequences } from "./rosterEdit";
import { commitAddedStudents, mintStudents, type AddedCodes } from "./addStudentsFlow";
import { AddedCodesCard } from "./AddedCodesCard";
import { Button, Card, ConfirmDialog, ErrorText, NumberInput } from "../../components/ui";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Add and remove students on a session that already exists.
 *
 * Enrollment churns for the first weeks of term while teams have to be assigned
 * early, and the roster used to be fixed at creation: the only way to take on a
 * late arrival was to delete the session and lose every response collected so
 * far.
 */
export function RosterPanel() {
  const { sid, session, students } = useSession();
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [allocationSaved, setAllocationSaved] = useState(false);

  // The one-time codes for students just added. Built before anything is
  // written, and dismissed only once the instructor confirms they saved it.
  const [added, setAdded] = useState<AddedCodes | null>(null);

  // Only whether one exists. That is enough to warn, and it is readable without
  // the passphrase — which the removal dialog must not stop to demand.
  useEffect(() => {
    let cancelled = false;
    void getAllocationDoc(sid)
      .then((d) => {
        if (!cancelled) setAllocationSaved(d != null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sid, session.rosterChangedAt]);

  const selectedStudents = useMemo(
    () => students.filter((s) => selected.has(s.hash)),
    [students, selected],
  );
  const consequences = useMemo(
    () => removalConsequences(selectedStudents, { allocationSaved }),
    [selectedStudents, allocationSaved],
  );

  function toggle(hash: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }

  async function add() {
    setError("");
    setBusy(true);
    try {
      const minted = await mintStudents(sid, session, students, count);
      const { bundle } = minted;
      try {
        const result = await commitAddedStudents(sid, minted);
        if (!result.ok) {
          // The claim was refused, so nothing was written and these codes
          // reached nobody. Say that, rather than handing over a file of codes
          // for students who do not exist.
          setError(`${result.refused} Nothing was added and no codes were issued.`);
          return;
        }
      } catch (err) {
        setAdded({ ...bundle, incomplete: errMsg(err) });
        downloadFile(bundle.filename, bundle.csv, "text/csv");
        return;
      }
      downloadFile(bundle.filename, bundle.csv, "text/csv");
      setAdded(bundle);
      setCount(1);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await removeStudents(
        sid,
        selectedStudents.map((s) => ({ hash: s.hash, codeIndex: s.codeIndex })),
      );
      setSelected(new Set());
      setConfirmRemove(false);
    } catch (err) {
      setError(`Could not remove: ${errMsg(err)}`);
    } finally {
      setBusy(false);
    }
  }

  if (added) return <AddedCodesCard added={added} onDismiss={() => setAdded(null)} />;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">Roster</h2>
          <p className="text-sm text-slate-600">
            {students.length} student{students.length === 1 ? "" : "s"}. Add students who joined late, or remove
            students who dropped. Numbers are never reused, so #{nextCodeIndex(students, session)} is next.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <NumberInput min={1} max={200} className="w-20" value={count} onValueChange={setCount} />
          <Button onClick={add} disabled={busy}>
            {busy ? "Adding…" : `Add ${count} student${count === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>

      {session.status !== "open" && (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          This session is {session.status}, so anyone you add cannot answer the survey until you open it again.
        </p>
      )}

      {session.teamMgmt?.rosterUploadedAt != null && (
        <p className="mb-3 text-sm text-slate-600">
          Teams are already provisioned. To put a new student straight onto a team, or to move or remove somebody
          from one, use the <strong>Teams</strong> tab instead — students added here are left off every team until
          you place them.
        </p>
      )}

      <p className="mb-2 text-sm text-slate-600">
        Select students to remove. Each tile is one login code — match the numbers against your private
        code-assignment CSV.
      </p>
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10">
        {students.map((s) => {
          const on = selected.has(s.hash);
          return (
            <button
              key={s.hash}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(s.hash)}
              title={s.submittedAt ? "Submitted — removing deletes their response" : "Not submitted"}
              className={`rounded-md border px-2 py-1.5 text-center text-xs font-medium ${
                on
                  ? "border-red-400 bg-red-100 text-red-900"
                  : s.submittedAt
                    ? "border-transparent bg-green-100 text-green-800 hover:border-slate-300"
                    : "border-transparent bg-slate-100 text-slate-500 hover:border-slate-300"
              }`}
            >
              #{s.codeIndex}
            </button>
          );
        })}
      </div>

      {selected.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="danger" disabled={busy} onClick={() => setConfirmRemove(true)}>
            Remove {selected.size} student{selected.size === 1 ? "" : "s"}
          </Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <ErrorText>{error}</ErrorText>

      <ConfirmDialog
        open={confirmRemove}
        title={
          selectedStudents.length === 1
            ? `Remove student #${selectedStudents[0]?.codeIndex}?`
            : `Remove ${selectedStudents.length} students?`
        }
        confirmLabel="Remove"
        busy={busy}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={remove}
      >
        <p>
          This deletes{" "}
          {selectedStudents.length === 1
            ? `#${selectedStudents[0]?.codeIndex}`
            : selectedStudents.map((s) => `#${s.codeIndex}`).join(", ")}{" "}
          for good.{" "}
          {selectedStudents.length === 1
            ? "Their login code stops working at once and cannot be reissued, and their number is retired"
            : "Their login codes stop working at once and cannot be reissued, and their numbers are retired"}{" "}
          — anyone you add later gets a new one. This cannot be undone.
        </p>
        {consequences
          .filter((c) => c !== "teamKeyRetained")
          .map((c) => (
            <p key={c}>{CONSEQUENCE_TEXT[c]}</p>
          ))}
        {consequences.includes("teamKeyRetained") && (
          <>
            <p className="font-medium">What removing does not do</p>
            <p>{CONSEQUENCE_TEXT.teamKeyRetained}</p>
          </>
        )}
      </ConfirmDialog>
    </Card>
  );
}
