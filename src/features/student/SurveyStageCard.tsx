import { useState } from "react";
import { submitResponse } from "../../lib/db";
import { eciesEncrypt } from "../../lib/crypto";
import type { PublicConfig, StudentDoc, SurveyAnswers } from "../../types";
import { Card, ErrorText } from "../../components/ui";
import { SurveyForm } from "./SurveyForm";

/** Inline survey card for the student hub (used while the survey is still open
 * on a team-management session). Kept separate from the standalone survey flow
 * so submitting here returns to the hub rather than a full-page success state. */
export function SurveyStageCard({
  sid,
  config,
  hash,
  student,
}: {
  sid: string;
  config: PublicConfig;
  hash: string;
  student: StudentDoc;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const alreadySubmitted = !!student.submittedAt;

  async function submit(answers: SurveyAnswers) {
    setBusy(true);
    setError("");
    try {
      const payload = await eciesEncrypt(config.publicKeyJwk, JSON.stringify(answers));
      await submitResponse(sid, hash, payload);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card>
        <h2 className="font-semibold text-green-700">Survey response saved ✓</h2>
        <p className="text-sm text-slate-600">Your answers were encrypted before upload.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="mb-1 font-semibold">Team-formation survey</h2>
      {alreadySubmitted && (
        <p className="mb-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
          You already submitted. Submitting again replaces your response.
        </p>
      )}
      <SurveyForm config={config} busy={busy} onSubmit={submit} />
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
