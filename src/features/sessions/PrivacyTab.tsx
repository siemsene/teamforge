import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "./SessionContext";
import { deleteSessionCompletely, purgeStudentData, saveTeamMgmt } from "../../lib/db";
import { publicTeamMgmt } from "../teams/contractTemplate";
import { Button, Card, ConfirmDialog, ErrorText } from "../../components/ui";

export function PrivacyTab() {
  const { sid, session, students } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  async function purge() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { students: n, failures } = await purgeStudentData(sid);
      // The team docs are gone, so the roster no longer describes anything.
      // Clearing the timestamp returns the Teams tab to its upload screen
      // rather than leaving it reporting "0 teams provisioned".
      if (session.teamMgmt?.rosterUploadedAt != null) {
        const next = { ...session.teamMgmt, rosterUploadedAt: null };
        await saveTeamMgmt(sid, next, publicTeamMgmt(next)).catch((e) =>
          failures.push(`team-management config: ${errMsg(e)}`),
        );
      }
      setConfirmPurge(false);
      if (failures.length > 0) {
        // Erasure is promised in plain words to students and instructors alike,
        // so a partial one is reported as a partial one.
        setError(
          `Purge incomplete — ${n} student record${n === 1 ? "" : "s"} deleted, but some data could not be removed: ` +
            `${failures.join("; ")}. Try again; anything already deleted stays deleted.`,
        );
        return;
      }
      setMessage(`Deleted ${n} student records, the saved allocation, and any team contracts and evaluations.`);
    } catch (e) {
      setError(`Could not purge student data: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAll() {
    setBusy(true);
    setError("");
    try {
      await deleteSessionCompletely(sid);
      navigate("/dashboard");
    } catch (e) {
      setError(`Could not delete the session: ${errMsg(e)}`);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 font-semibold">How this session protects students</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>
            Students are identified only by random login codes. The mapping from codes to real names exists solely in
            the CSV you downloaded — keep it private and delete it when the course ends.
          </li>
          <li>
            Survey answers are encrypted in the student's browser with this session's public key. Decryption requires
            your passphrase (or recovery key) and happens only in your browser — the server stores ciphertext.
          </li>
          <li>The optimizer runs locally in your browser; decrypted data is never uploaded.</li>
          <li>The saved team allocation is also stored encrypted.</li>
          {session.teamMgmt?.enabled && (
            <li>
              Team names and rosters are encrypted with a key derived from each student's login code; team contracts
              and peer evaluations are encrypted so only you (and, for contracts, the team) can read them. If AI
              contract feedback is enabled, only contract text — no names — leaves this end-to-end encryption.
            </li>
          )}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">Good practice</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Purge student data once teams are final — you keep your own exported CSV of teams.</li>
          <li>Store the recovery key file separately from the login-codes CSV.</li>
          <li>Tell students about these protections; it improves survey honesty and completion.</li>
        </ul>
      </Card>

      <Card className="border-red-200">
        <h2 className="mb-2 font-semibold text-red-700">Danger zone</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              Remove all student data ({students.length} records) and the allocation. Keeps projects, survey and
              constraints.
            </p>
            <Button variant="danger" disabled={busy} onClick={() => setConfirmPurge(true)}>
              Purge student data
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">Delete the entire session.</p>
            <Button variant="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Delete session
            </Button>
          </div>
          {message && <p className="text-sm text-green-700">{message}</p>}
          <ErrorText>{error}</ErrorText>
        </div>
      </Card>
      <ConfirmDialog
        open={confirmPurge}
        title="Purge student data?"
        confirmLabel="Purge data"
        busy={busy}
        onCancel={() => setConfirmPurge(false)}
        onConfirm={purge}
      >
        <p>
          This deletes all {students.length} student records, encrypted responses, login-code hashes, any saved
          allocation, and all team-management data (contracts, peer evaluations, and the encrypted team directory) for{" "}
          <strong>{session.title}</strong>.
        </p>
        <p>Students would need new codes to participate again. This cannot be undone.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete entire session?"
        confirmLabel="Delete session"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={deleteAll}
      >
        <p>
          This permanently deletes <strong>{session.title}</strong>, including students, projects, survey,
          constraints, and allocation.
        </p>
        <p>This cannot be undone.</p>
      </ConfirmDialog>
    </div>
  );
}
