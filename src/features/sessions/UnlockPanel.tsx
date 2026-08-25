import { useState, type FormEvent } from "react";
import { unlockWithPassphrase, unlockWithRecoveryKey } from "../../lib/crypto";
import type { WrappedKeys } from "../../types";
import { Button, Card, ErrorText, Field, Input } from "../../components/ui";

/**
 * Prompts the instructor for the session passphrase (or recovery key) and hands
 * back the unlocked private key. Decryption happens only in this browser tab and
 * nothing decrypted is uploaded. Shared by the Allocation, Teams, and Peer-evals
 * tabs (the unlocked key lives in SessionContext for the page lifetime).
 */
export function UnlockPanel({
  wrapped,
  error,
  title = "Unlock student data",
  intro,
  onUnlocked,
}: {
  wrapped: WrappedKeys;
  error?: string;
  title?: string;
  intro?: string;
  onUnlocked: (key: CryptoKey) => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [recovery, setRecovery] = useState("");
  const [localError, setLocalError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLocalError("");
    setBusy(true);
    try {
      const key = passphrase
        ? await unlockWithPassphrase(wrapped, passphrase)
        : await unlockWithRecoveryKey(wrapped, recovery);
      onUnlocked(key);
    } catch {
      setLocalError("Could not unlock — wrong passphrase or recovery key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-lg">
      <h2 className="mb-2 font-semibold">{title}</h2>
      <p className="mb-3 text-sm text-slate-600">
        {intro ??
          "Responses are encrypted; decryption happens only in this browser tab and nothing decrypted is ever uploaded. Enter your session passphrase (or paste the recovery key from your backup file)."}
      </p>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Session passphrase">
          <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
        </Field>
        <Field label="… or recovery key">
          <Input value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="Base64 recovery key" />
        </Field>
        <ErrorText>{localError || error}</ErrorText>
        <Button type="submit" disabled={busy || (!passphrase && !recovery)}>
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
    </Card>
  );
}
