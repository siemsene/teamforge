import { useEffect, useMemo, useState } from "react";
import { useSession } from "../sessions/SessionContext";
import { addStudents, getAllocationDoc, removeStudents, CodeIndexRaceError } from "../../lib/db";
import { generateCodes, generateShareCodes, hashCode } from "../../lib/codes";
import { downloadFile, sessionFilename, surveyUrl, toCsv } from "../../lib/util";
import {
  addedCodesCsvRows,
  addedCodesSuffix,
  nextCodeIndex,
  observedMaxCodeIndex,
  removalConsequences,
  type RemovalConsequence,
} from "./rosterEdit";
import { Button, Card, ConfirmDialog, ErrorText, NumberInput } from "../../components/ui";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * What each consequence means, in the instructor's terms. Kept as data so the
 * dialog can say what is true for this particular selection rather than warning
 * in general terms about everything that might be affected.
 */
const CONSEQUENCE_TEXT: Record<RemovalConsequence, string> = {
  hasResponse:
    "Their encrypted survey response is deleted with them. If you have already run the optimizer, run it again — it was solved with their answers in it.",
  inSavedAllocation:
    "This session has a saved allocation. Open the Allocation tab, re-run the optimizer (or move the rest by hand) and save, or a team keeps a seat for somebody who is gone.",
  provisionedTeam:
    "They are on a provisioned team. Re-upload your login-codes CSV on the Teams tab so their teammates stop seeing them on the contract and on the peer-evaluation form.",
  submittedBallot:
    "The peer evaluation they submitted goes with them. Their teammates' ballots do not: the points allocated to this student are dropped and the rest scaled back up, so what those ballots judged about everyone else is kept.",
  resultsPublished:
    "Results were already published to them. They will not be able to open them again.",
  teamKeyRetained:
    "Removing them does not take back the team key they already hold. Someone who kept it can still read and edit that team's contract while team management is on. To cut that off, re-upload the roster giving that team a different label — that mints a new key, and starts that team's contract and display names afresh.",
};

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

  // The one-time codes for students just added. Mirrors the bundle session
  // creation hands over: built before anything is written, and dismissed only
  // once the instructor confirms they saved it.
  const [added, setAdded] = useState<{
    firstIndex: number;
    lastIndex: number;
    filename: string;
    csv: string;
    /** Set when the write failed after the codes had been generated. */
    incomplete?: string;
  } | null>(null);

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
    if (count < 1) return setError("Add at least one student.");
    if (students.length + count > 1000) {
      return setError(`A session holds at most 1000 students; this one has ${students.length}.`);
    }
    setBusy(true);
    try {
      const first = nextCodeIndex(students, session);
      const codes = generateCodes(count);
      const hashes = await Promise.all(codes.map(hashCode));
      const shareCodes = generateShareCodes(
        count,
        students.map((s) => s.shareCode ?? "").filter(Boolean),
      );
      const roster = hashes.map((hash, i) => ({
        hash,
        shareCode: shareCodes[i],
        codeIndex: first + i,
      }));
      const last = first + count - 1;

      // Build the file before writing anything. The codes exist only in this
      // variable — Firestore keeps nothing but their hashes — so a write that
      // fails halfway must not take them down with it.
      const csv = toCsv(
        addedCodesCsvRows(
          roster.map((r, i) => ({ codeIndex: r.codeIndex, code: codes[i], shareCode: r.shareCode })),
          surveyUrl(sid),
        ),
      );
      const bundle = {
        firstIndex: first,
        lastIndex: last,
        filename: sessionFilename(session.title, sid, addedCodesSuffix(first, last)),
        csv,
      };

      try {
        await addStudents(sid, roster, observedMaxCodeIndex(students, session));
      } catch (err) {
        if (err instanceof CodeIndexRaceError) {
          // The claim was refused, so nothing was written and these codes
          // reached nobody. Say that, rather than handing over a file of codes
          // for students who do not exist.
          setError(`${err.message} Nothing was added and no codes were issued.`);
          return;
        }
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

  if (added) {
    const many = added.lastIndex !== added.firstIndex;
    return (
      <Card>
        {added.incomplete ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">These students may only be partly added.</p>
            <p className="mt-1">Saving them failed: {added.incomplete}</p>
            <p className="mt-1">
              <strong>Save the file anyway.</strong> It holds the only copy of these login codes. Then check the
              roster below: if the new numbers are not there, add them again and discard this file.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <p className="font-medium">
              Added {added.lastIndex - added.firstIndex + 1} student{many ? "s" : ""} (#{added.firstIndex}
              {many ? `–#${added.lastIndex}` : ""}).
            </p>
            <p className="mt-1">
              Save this file now — login codes are not stored in plaintext and cannot be recovered after you leave
              this screen.
            </p>
            <p className="mt-1">
              <strong>Append these rows to the master codes CSV</strong> you saved when you created the session. The
              roster import on the Teams tab needs one file covering the whole class; uploading only these rows would
              delete every team that is not in it.
            </p>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => downloadFile(added.filename, added.csv, "text/csv")}>
            Download again
          </Button>
          <Button onClick={() => setAdded(null)}>I saved the file</Button>
        </div>
      </Card>
    );
  }

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
