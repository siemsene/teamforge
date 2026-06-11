import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "./SessionContext";
import { deleteSessionCompletely, purgeStudentData } from "../../lib/db";
import { Button, Card } from "../../components/ui";

export function PrivacyTab() {
  const { sid, session, students } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function purge() {
    if (
      !window.confirm(
        `Permanently delete all ${students.length} student records (encrypted responses, login code hashes) and any saved allocation for "${session.title}"?\n\nThis cannot be undone. Students would need new codes to participate again.`,
      )
    )
      return;
    setBusy(true);
    try {
      const n = await purgeStudentData(sid);
      setMessage(`Deleted ${n} student records and the saved allocation.`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAll() {
    if (
      !window.confirm(
        `Permanently delete the ENTIRE session "${session.title}" — students, projects, survey, constraints, allocation?\n\nThis cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      await deleteSessionCompletely(sid);
      navigate("/dashboard");
    } finally {
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
            <Button variant="danger" disabled={busy} onClick={purge}>
              Purge student data
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">Delete the entire session.</p>
            <Button variant="danger" disabled={busy} onClick={deleteAll}>
              Delete session
            </Button>
          </div>
          {message && <p className="text-sm text-green-700">{message}</p>}
        </div>
      </Card>
    </div>
  );
}
