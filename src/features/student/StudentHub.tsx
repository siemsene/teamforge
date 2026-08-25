import { useEffect, useState } from "react";
import { getStudentByHash, getTeamByTokenHash } from "../../lib/db";
import { deriveMemberKey, hashTeamToken, openEnvelope } from "../../lib/memberKey";
import type { PublicConfig, RosterInfo, StudentDoc, TeamDoc } from "../../types";
import { Card, Spinner } from "../../components/ui";
import { SurveyStageCard } from "./SurveyStageCard";
import { ContractEditor } from "./ContractEditor";
import { PeerEvalCard } from "./PeerEvalCard";
import { FormativeResults } from "./FormativeResults";

/**
 * Landing page for a student once team management is enabled. Derives the
 * member key from the login code (memory only), decrypts the roster blob, and
 * surfaces the survey, team, contract, peer-eval rounds, and any published
 * results.
 */
export function StudentHub({
  sid,
  config,
  hash,
  code,
  student,
}: {
  sid: string;
  config: PublicConfig;
  hash: string;
  code: string;
  student: StudentDoc;
}) {
  const [memberKey, setMemberKey] = useState<CryptoKey | null>(null);
  const [roster, setRoster] = useState<RosterInfo | null>(null);
  const [team, setTeam] = useState<(TeamDoc & { tokenHash: string }) | null>(null);
  const [current, setCurrent] = useState<StudentDoc>(student);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const key = await deriveMemberKey(sid, code);
        setMemberKey(key);
        if (student.roster) {
          const info = JSON.parse(await openEnvelope(key, student.roster)) as RosterInfo;
          setRoster(info);
          const tokenHash = await hashTeamToken(info.teamToken);
          const teamDoc = await getTeamByTokenHash(sid, tokenHash);
          if (teamDoc) setTeam({ ...teamDoc, tokenHash });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, code]);

  async function refresh() {
    const [fresh, info] = [await getStudentByHash(sid, hash), roster];
    if (fresh) setCurrent(fresh);
    if (info && memberKey) {
      const tokenHash = await hashTeamToken(info.teamToken);
      const teamDoc = await getTeamByTokenHash(sid, tokenHash);
      if (teamDoc) setTeam({ ...teamDoc, tokenHash });
    }
  }

  if (loading) return <Spinner label="Unlocking your team…" />;

  const tm = config.teamMgmt!;

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-xl font-bold">{config.title}</h1>
        <p className="text-sm text-slate-600">
          {roster ? `${roster.teamLabel}` : "Your team hasn't been set up yet."}
        </p>
      </Card>

      {error && (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      )}

      {config.status === "open" && <SurveyStageCard sid={sid} config={config} hash={hash} student={current} />}

      {!roster && (
        <Card>
          <h2 className="mb-1 font-semibold">Your team</h2>
          <p className="text-sm text-slate-600">
            Your instructor hasn't uploaded the final teams yet. Check back once teams are announced.
          </p>
        </Card>
      )}

      {roster && (
        <>
          <Card>
            <h2 className="mb-1 font-semibold">Your team — {roster.teamLabel}</h2>
            <ul className="text-sm text-slate-700">
              <li className="font-medium">{roster.name} (you)</li>
              {roster.teammates.map((t) => (
                <li key={t.codeIndex}>{t.name}</li>
              ))}
            </ul>
          </Card>

          {memberKey && team && (
            <ContractEditor
              sid={sid}
              config={config}
              roster={roster}
              team={team}
              onSaved={refresh}
            />
          )}

          <PeerEvalCard
            sid={sid}
            config={config}
            hash={hash}
            roster={roster}
            round="formative"
            submission={current.peerEvalFormative ?? null}
            onChanged={refresh}
          />
          <PeerEvalCard
            sid={sid}
            config={config}
            hash={hash}
            roster={roster}
            round="summative"
            submission={current.peerEvalSummative ?? null}
            onChanged={refresh}
          />

          {memberKey && tm.rounds.formative.resultsPublished && current.resultFormative && (
            <FormativeResults memberKey={memberKey} envelope={current.resultFormative} />
          )}
          {memberKey && tm.rounds.summative.resultsPublished && current.resultSummative && (
            <FormativeResults memberKey={memberKey} envelope={current.resultSummative} />
          )}
        </>
      )}

      <Card className="bg-indigo-50">
        <h2 className="mb-1 font-semibold">Your privacy</h2>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{config.privacyNote}</p>
      </Card>
    </div>
  );
}
