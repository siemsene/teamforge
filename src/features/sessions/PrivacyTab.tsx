import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "./SessionContext";
import { deleteSessionCompletely, purgeStudentData } from "../../lib/db";
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
      const n = await purgeStudentData(sid);
      setMessage(`Deleted ${n} student records and the saved allocation.`);
      setConfirmPurge(false);
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
          This deletes all {students.length} student records, encrypted responses, login-code hashes, and any saved
          allocation for <strong>{session.title}</strong>.
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
