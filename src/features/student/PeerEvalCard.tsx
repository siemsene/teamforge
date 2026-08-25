import { useState } from "react";
import { submitPeerEval, withdrawPeerEval } from "../../lib/db";
import { eciesEncrypt } from "../../lib/crypto";
import type { EvalRoundId, PeerEvalAnswers, PeerEvalSubmission, PublicConfig, RosterInfo } from "../../types";
import { Button, Card, ConfirmDialog, ErrorText } from "../../components/ui";
import { PeerEvalForm } from "./PeerEvalForm";

const ROUND_TITLE: Record<EvalRoundId, string> = {
  formative: "Peer evaluation — practice round",
  summative: "Peer evaluation — graded round",
};

/** One round's card in the student hub: shows the form while the round is open,
 * the submitted state otherwise. */
export function PeerEvalCard({
  sid,
  config,
  hash,
  roster,
  round,
  submission,
  onChanged,
}: {
  sid: string;
  config: PublicConfig;
  hash: string;
  roster: RosterInfo;
  round: EvalRoundId;
  submission: PeerEvalSubmission | null;
  onChanged: () => void | Promise<void>;
}) {
  const tm = config.teamMgmt!;
  const roundCfg = tm.rounds[round];
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  if (roundCfg.status === "pending") {
    // Don't clutter the hub with a round the instructor hasn't opened yet,
    // unless they attached a note (e.g. "opens Oct 6").
    if (!roundCfg.note) return null;
    return (
      <Card>
        <h2 className="mb-1 font-semibold">{ROUND_TITLE[round]}</h2>
        <p className="text-sm text-slate-600">{roundCfg.note}</p>
      </Card>
    );
  }

  async function submit(answers: PeerEvalAnswers) {
    setBusy(true);
    setError("");
    try {
      const payload = await eciesEncrypt(config.publicKeyJwk, JSON.stringify(answers));
      await submitPeerEval(sid, hash, round, { submittedAt: Date.now(), payload });
      setEditing(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    setError("");
    try {
      await withdrawPeerEval(sid, hash, round);
      setConfirmWithdraw(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const closed = roundCfg.status === "closed";

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold">{ROUND_TITLE[round]}</h2>
        {submission && <span className="text-xs text-green-700">Submitted</span>}
      </div>
      {roundCfg.note && <p className="mb-2 text-sm text-slate-600">{roundCfg.note}</p>}

      {closed ? (
        <p className="text-sm text-slate-600">
          {submission
            ? "This round is closed. Thank you — your evaluation was recorded."
            : "This round is closed."}
        </p>
      ) : editing ? (
        <>
          <PeerEvalForm roster={roster} tm={tm} round={round} busy={busy} onSubmit={submit} />
          <div className="mt-2">
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </>
      ) : submission ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">
            You submitted this evaluation. You can revise or withdraw it while the round is open.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Revise
            </Button>
            <Button variant="ghost" onClick={() => setConfirmWithdraw(true)}>
              Withdraw
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setEditing(true)}>Start evaluation</Button>
      )}

      <ErrorText>{error}</ErrorText>
      <ConfirmDialog
        open={confirmWithdraw}
        title="Withdraw your evaluation?"
        confirmLabel="Withdraw"
        busy={busy}
        onCancel={() => setConfirmWithdraw(false)}
        onConfirm={withdraw}
      >
        <p>Your submitted answers will be deleted. You can submit again while the round is open.</p>
      </ConfirmDialog>
    </Card>
  );
}
