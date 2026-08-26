import { useEffect, useMemo, useState } from "react";
import { ContractConflictError, updateContract } from "../../lib/db";
import { eciesEncrypt } from "../../lib/crypto";
import { deriveTeamKey, openEnvelope, sealEnvelope } from "../../lib/memberKey";
import { aiFeedbackConfigured, requestContractFeedback } from "../../lib/aiFeedback";
import type {
  ContractContent,
  ContractFeedback,
  ContractState,
  PublicConfig,
  RosterInfo,
  TeamDoc,
} from "../../types";
import { Button, Card, ConfirmDialog, ErrorText, Spinner, TextArea } from "../../components/ui";
import { ContractPrint } from "../teams/ContractPrint";
import { contractPdfName, printAs } from "../../lib/printPdf";

/** Turns the transaction's refusal into something a student can act on. */
function conflictMessage(e: unknown): string {
  if (e instanceof ContractConflictError) {
    return "A teammate saved this contract while you were editing, so your version was not written — nothing of theirs was lost. Reload to see what they wrote, then re-apply your changes.";
  }
  return e instanceof Error ? e.message : String(e);
}

interface SectionState {
  id: string;
  title: string;
  prompt: string;
  text: string;
}

/** Team contract editor: any member may draft, request AI feedback, and
 * finalize. Content is encrypted under the team key; a copy is sealed to the
 * instructor's session key. Concurrency is last-write-wins with a stale warning. */
export function ContractEditor({
  sid,
  config,
  roster,
  team,
  onSaved,
}: {
  sid: string;
  config: PublicConfig;
  roster: RosterInfo;
  team: TeamDoc & { tokenHash: string };
  onSaved: () => void | Promise<void>;
}) {
  const tm = config.teamMgmt!;
  const [teamKey, setTeamKey] = useState<CryptoKey | null>(null);
  const [sections, setSections] = useState<SectionState[]>([]);
  const [feedback, setFeedback] = useState<ContractFeedback | null>(null);
  const [status, setStatus] = useState<ContractState["status"]>(team.contract.status);
  const [loadedAt, setLoadedAt] = useState<number | null>(team.contract.updatedAt);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [dirty, setDirty] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [confirmAi, setConfirmAi] = useState(false);
  const [printing, setPrinting] = useState<ContractContent | null>(null);

  const myCodeIndex = roster.codeIndex;

  // Reload whenever the team doc changes — StudentHub keeps a live subscription
  // on it — but never on top of unsaved typing. A teammate's save used to be
  // invisible until a full page reload, which is what the stale banner was
  // apologising for.
  useEffect(() => {
    if (dirty) return;
    (async () => {
      try {
        const key = await deriveTeamKey(sid, roster.teamToken);
        setTeamKey(key);
        let content: ContractContent | null = null;
        if (team.contract.content) {
          content = JSON.parse(await openEnvelope(key, team.contract.content)) as ContractContent;
        }
        setFeedback(
          team.contract.feedback
            ? (JSON.parse(await openEnvelope(key, team.contract.feedback)) as ContractFeedback)
            : null,
        );
        const byId = new Map((content?.sections ?? []).map((s) => [s.id, s.text]));
        setSections(
          tm.contractSections.map((def) => ({
            id: def.id,
            title: def.title,
            prompt: def.prompt,
            text: byId.get(def.id) ?? "",
          })),
        );
        setStatus(team.contract.status);
        setLoadedAt(team.contract.updatedAt);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, team.tokenHash, team.contract.updatedAt, dirty]);

  // Only meaningful while there is unsaved typing: otherwise the effect above
  // has already pulled the teammate's version in.
  const stale = dirty && loadedAt !== team.contract.updatedAt;
  const finalized = status === "final";

  function buildContent(): ContractContent {
    return { version: 1, sections: sections.map((s) => ({ id: s.id, title: s.title, text: s.text })) };
  }

  async function persist(nextStatus: ContractState["status"], nextFeedback: ContractFeedback | null) {
    if (!teamKey) return;
    const content = buildContent();
    const sealed = await sealEnvelope(teamKey, JSON.stringify(content));
    const forInstructor = await eciesEncrypt(config.publicKeyJwk, JSON.stringify(content));
    const sealedFeedback = nextFeedback ? await sealEnvelope(teamKey, JSON.stringify(nextFeedback)) : null;
    const now = Date.now();
    const next: ContractState = {
      status: nextStatus,
      updatedAt: now,
      updatedByCodeIndex: myCodeIndex,
      content: sealed,
      contentForInstructor: forInstructor,
      feedback: sealedFeedback,
      feedbackAt: nextFeedback ? now : team.contract.feedbackAt,
      finalizedAt: nextStatus === "final" ? now : nextStatus === "draft" ? null : team.contract.finalizedAt,
    };
    // The transaction refuses the write if a teammate saved since we loaded,
    // so their work cannot be silently overwritten by ours.
    await updateContract(sid, team.tokenHash, next, loadedAt);
    setStatus(nextStatus);
    setLoadedAt(now);
    setDirty(false);
    await onSaved();
  }

  async function saveDraft() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await persist("draft", feedback);
      setInfo("Draft saved. Your teammates can see it when they open this page.");
    } catch (e) {
      setError(conflictMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function getFeedback() {
    setConfirmAi(false);
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const fb = await requestContractFeedback(
        sections.map((s) => ({ id: s.id, title: s.title, text: s.text })),
        roster.teammates.length + 1,
      );
      setFeedback(fb);
      await persist("draft", fb);
      setInfo("AI feedback received. Revise your contract, then finalize when the team agrees.");
    } catch (e) {
      setError(conflictMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    setConfirmFinalize(false);
    setBusy(true);
    setError("");
    try {
      await persist("final", feedback);
      setInfo("Contract finalized. Every member can now download the PDF.");
    } catch (e) {
      setError(conflictMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    try {
      await persist("draft", feedback);
      setInfo("Reopened for editing.");
    } catch (e) {
      setError(conflictMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const feedbackById = useMemo(() => new Map((feedback?.sections ?? []).map((s) => [s.id, s])), [feedback]);
  const showAi = tm.aiFeedbackEnabled && aiFeedbackConfigured();

  if (loading) return <Spinner label="Loading your team contract…" />;

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Team contract</h2>
        <span className="text-xs text-slate-500">
          {finalized ? "Finalized" : status === "draft" ? "Draft in progress" : "Not started"}
        </span>
      </div>
      <p className="mb-3 text-sm text-slate-600">
        Any team member can edit this. Write your team&rsquo;s norms for each area below. Your instructor can read it
        from the moment you first save &mdash; drafts included &mdash; so nothing here is private to the team. Do not
        include anyone&rsquo;s full name if you plan to request AI feedback.
      </p>

      {stale && (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          A teammate saved a newer version while you were typing. Your unsaved edits are still here, but saving them
          would replace what they wrote — copy anything you need, then reload to start from their version.
        </p>
      )}

      <div className="space-y-4">
        {sections.map((s, i) => (
          <div key={s.id}>
            <label className="block text-sm font-semibold text-slate-800">{s.title}</label>
            <p className="mb-1 text-xs text-slate-500">{s.prompt}</p>
            <TextArea
              rows={3}
              value={s.text}
              disabled={finalized || busy}
              onChange={(e) => {
                setDirty(true);
                setSections((prev) => prev.map((p, j) => (j === i ? { ...p, text: e.target.value } : p)));
              }}
            />
            {feedbackById.get(s.id) && (
              <div className="mt-1 rounded-md bg-indigo-50 p-2 text-xs text-indigo-900">
                <p>
                  <strong>Strengths:</strong> {feedbackById.get(s.id)!.strengths}
                </p>
                <p>
                  <strong>Watch out:</strong> {feedbackById.get(s.id)!.risks}
                </p>
                <p>
                  <strong>Suggestion:</strong> {feedbackById.get(s.id)!.suggestions}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {feedback?.overall && (
        <div className="mt-3 rounded-md bg-indigo-50 p-2 text-sm text-indigo-900">
          <p className="font-medium">AI feedback — overall</p>
          <p>{feedback.overall}</p>
        </div>
      )}

      <ErrorText>{error}</ErrorText>
      {info && <p className="mt-2 text-sm text-green-700">{info}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {!finalized && (
          <Button onClick={saveDraft} disabled={busy}>
            {busy ? "Saving…" : "Save draft"}
          </Button>
        )}
        {!finalized && showAi && (
          <Button variant="secondary" onClick={() => setConfirmAi(true)} disabled={busy}>
            Get AI feedback
          </Button>
        )}
        {!finalized && (
          <Button variant="secondary" onClick={() => setConfirmFinalize(true)} disabled={busy}>
            Finalize
          </Button>
        )}
        {finalized && (
          <Button variant="secondary" onClick={reopen} disabled={busy}>
            Reopen for editing
          </Button>
        )}
        <Button
          variant="secondary"
          title="Opens your browser's print dialog — choose 'Save as PDF' as the destination."
          onClick={() => {
            setPrinting(buildContent());
            // Let the printable layout render before the dialog opens.
            setTimeout(() => printAs(contractPdfName(config.title, roster.teamLabel)), 50);
          }}
        >
          Save as PDF
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        &ldquo;Save as PDF&rdquo; opens your browser&rsquo;s print dialog — choose <em>Save as PDF</em> (or
        <em> Microsoft Print to PDF</em>) as the destination rather than a printer. The file is named for your course
        and team.
      </p>

      <ConfirmDialog
        open={confirmAi}
        tone="primary"
        title="Send contract for AI feedback?"
        confirmLabel="Send for feedback"
        busy={busy}
        onCancel={() => setConfirmAi(false)}
        onConfirm={getFeedback}
      >
        <p>
          Your contract text — and nothing else — will be sent to an AI service outside this app's end-to-end
          encryption to generate feedback. Make sure you haven't written anyone's full name.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmFinalize}
        tone="primary"
        title="Finalize this contract?"
        confirmLabel="Finalize"
        busy={busy}
        onCancel={() => setConfirmFinalize(false)}
        onConfirm={finalize}
      >
        <p>
          Finalizing records that your team has agreed this contract, and every member can then save it as a PDF. Your
          instructor can already read it, drafts included &mdash; this marks it as settled. You can reopen it for edits
          later if needed.
        </p>
      </ConfirmDialog>

      {printing && (
        <ContractPrint
          sessionTitle={config.title}
          teamLabel={roster.teamLabel}
          content={printing}
          finalizedAt={finalized ? (team.contract.finalizedAt ?? Date.now()) : null}
        />
      )}
    </Card>
  );
}
