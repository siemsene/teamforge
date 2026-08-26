import { useState } from "react";
import { Button, Card, ErrorText, TextArea } from "./ui";

/**
 * An editable, copyable email draft.
 *
 * The instructor edits it to match their course, saves it to the session, and
 * copies it into their mail merge. `fallback` is regenerated from live config,
 * so an unedited draft always reflects the current settings; once edited, the
 * saved text is left alone and "Reset to default" brings the fresh one back.
 */
export function EmailTemplateCard({
  title,
  intro,
  saved,
  fallback,
  onSave,
}: {
  title: string;
  intro: string;
  /** Persisted text, or undefined when the instructor has never edited it. */
  saved?: string;
  fallback: string;
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(saved ?? fallback);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const dirty = text !== (saved ?? fallback);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await onSave(text);
      setMsg("Saved.");
      setTimeout(() => setMsg(""), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMsg("Copied.");
      setTimeout(() => setMsg(""), 1500);
    } catch {
      setError("Could not copy — select the text and copy it manually.");
    }
  }

  return (
    <Card>
      <h2 className="mb-1 font-semibold">{title}</h2>
      <p className="mb-2 text-sm text-slate-600">
        {intro} Placeholders in <code className="rounded bg-slate-100 px-1 text-xs">&lt;ANGLE BRACKETS&gt;</code> are
        for your mail merge to fill in.
      </p>
      <TextArea rows={14} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : dirty ? "Save" : "Saved"}
        </Button>
        <Button variant="secondary" onClick={copy}>
          Copy email
        </Button>
        <Button variant="ghost" onClick={() => setText(fallback)} disabled={text === fallback}>
          Reset to default
        </Button>
        {msg && <span className="text-sm text-green-700">{msg}</span>}
      </div>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
