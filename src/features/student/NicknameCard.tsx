import { useState, type FormEvent } from "react";
import { NICKNAME_MAX_LENGTH, type Nicknames } from "../../types";
import { sanitizeNickname, validateNickname } from "../../lib/nicknames";
import { Button, Card, ErrorText, Input } from "../../components/ui";

/**
 * Lets a student choose the display name their team and instructor will see.
 *
 * This is the only name TeamForge holds for a student, it is chosen by them
 * rather than supplied by the instructor, and it is sealed under the team key
 * before it leaves the browser. Until one is set the student appears to
 * teammates as their code index, so the card is prominent while empty and
 * recedes to a one-line summary afterwards.
 */
export function NicknameCard({
  codeIndex,
  nicknames,
  busy,
  onSave,
}: {
  codeIndex: number;
  nicknames: Nicknames;
  busy: boolean;
  onSave: (nickname: string) => Promise<void>;
}) {
  const current = nicknames[String(codeIndex)] ?? "";
  const [editing, setEditing] = useState(!current);
  const [value, setValue] = useState(current);
  const [error, setError] = useState("");

  const taken = Object.entries(nicknames)
    .filter(([idx]) => Number(idx) !== codeIndex)
    .map(([, name]) => name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problems = validateNickname(value, taken);
    setError(problems[0] ?? "");
    if (problems.length > 0) return;
    await onSave(sanitizeNickname(value));
    setEditing(false);
  }

  if (!editing) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-700">
            Your display name: <strong>{current}</strong>{" "}
            <span className="text-slate-500">(your teammates see this; you are #{codeIndex})</span>
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setValue(current);
              setEditing(true);
            }}
          >
            Change
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className={current ? undefined : "border-indigo-300 bg-indigo-50"}>
      <h2 className="mb-1 font-semibold">{current ? "Change your display name" : "Choose a display name"}</h2>
      <p className="mb-2 text-sm text-slate-700">
        Your instructor never uploaded your name — this is the only name TeamForge holds for you, and you choose it
        yourself. It is encrypted in your browser, so only your team and your instructor can read it.
      </p>
      <p className="mb-1 text-sm font-medium text-slate-700">Where it appears:</p>
      <ul className="mb-2 list-disc pl-5 text-sm text-slate-700">
        <li>On your team page, so your teammates know who is on the team.</li>
        <li>Next to your name when teammates allocate peer-evaluation points, so they rate the right person.</li>
        <li>Beside your code number (#{codeIndex}) when your instructor reviews contracts and evaluations.</li>
      </ul>
      <p className="mb-3 text-sm text-slate-700">
        You can use your real name, a short form, or any nickname you like — <strong>but tell your teammates which
        name you picked</strong>, so they know which entry is you when they evaluate the team. If you pick something
        they don't recognise, they cannot rate you fairly. You can change it any time.
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-start gap-2">
        <div className="min-w-56 flex-1">
          <Input
            value={value}
            maxLength={NICKNAME_MAX_LENGTH}
            placeholder="e.g. Alex R. — or any name your team will recognise"
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save display name"}
        </Button>
        {current && (
          <Button variant="ghost" type="button" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </Button>
        )}
      </form>
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}
