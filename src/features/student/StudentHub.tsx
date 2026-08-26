import { useEffect, useState } from "react";
import { getStudentByHash, getTeamByTokenHash, setNickname, watchTeam } from "../../lib/db";
import { deriveMemberKey, deriveTeamKey, hashTeamToken, openEnvelope } from "../../lib/memberKey";
import { displayName, openNicknames, sealNickname } from "../../lib/nicknames";
import type { EvalRoundId, Nicknames, PublicConfig, RosterInfo, StudentDoc, TeamDoc } from "../../types";
import { Card, Spinner } from "../../components/ui";
import { SurveyStageCard } from "./SurveyStageCard";
import { ContractEditor } from "./ContractEditor";
import { NicknameCard } from "./NicknameCard";
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
  const [teamKey, setTeamKey] = useState<CryptoKey | null>(null);
  const [nicknames, setNicknames] = useState<Nicknames>({});
  const [savingNickname, setSavingNickname] = useState(false);
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
          const tKey = await deriveTeamKey(sid, info.teamToken);
          setTeamKey(tKey);
          if (teamDoc) setNicknames(await openNicknames(tKey, teamDoc.nicknames));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, code]);

  // Live view of the team document. Any member may edit the contract and every
  // member picks their own display name, so the team doc changes underneath a
  // student who is doing nothing. Polling it only when *this* student saved was
  // why the "a teammate saved a newer version" warning could never fire.
  useEffect(() => {
    if (!roster || !teamKey) return;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const tokenHash = await hashTeamToken(roster.teamToken);
      if (cancelled) return;
      unsub = watchTeam(sid, tokenHash, (doc) => {
        if (!doc) return;
        setTeam({ ...doc, tokenHash });
        void openNicknames(teamKey, doc.nicknames).then(setNicknames);
      });
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [sid, roster, teamKey]);

  async function refresh() {
    const [fresh, info] = [await getStudentByHash(sid, hash), roster];
    if (fresh) setCurrent(fresh);
    if (info && memberKey) {
      const tokenHash = await hashTeamToken(info.teamToken);
      const teamDoc = await getTeamByTokenHash(sid, tokenHash);
      if (teamDoc) {
        setTeam({ ...teamDoc, tokenHash });
        if (teamKey) setNicknames(await openNicknames(teamKey, teamDoc.nicknames));
      }
    }
  }

  /** Seal the chosen name under the team key and write just that one entry. */
  async function saveNickname(nickname: string) {
    if (!roster || !team || !teamKey) return;
    setSavingNickname(true);
    setError("");
    try {
      const sealed = await sealNickname(teamKey, nickname);
      await setNickname(sid, team.tokenHash, roster.codeIndex, sealed);
      await refresh();
    } catch (e) {
      // The rules now let the first writer create the nicknames map, so a
      // permission error here means something else — most often that the
      // instructor changed the teams and this student has moved.
      const message = e instanceof Error ? e.message : String(e);
      setError(
        /permission/i.test(message)
          ? "Could not save that name. Your team may have changed — reload the page and try again."
          : message,
      );
    } finally {
      setSavingNickname(false);
    }
  }

  if (loading) return <Spinner label="Unlocking your team…" />;

  const tm = config.teamMgmt!;

  // An open round is the reason the student logged in, so it goes above the
  // team roster and the contract editor rather than below them. Closed rounds,
  // and pending ones carrying a note, stay further down where they were —
  // there is nothing to do in them.
  const ROUNDS: EvalRoundId[] = ["formative", "summative"];
  const evalCard = (round: EvalRoundId) =>
    roster && (
      <PeerEvalCard
        key={round}
        sid={sid}
        config={config}
        hash={hash}
        roster={roster}
        nicknames={nicknames}
        round={round}
        submission={(round === "formative" ? current.peerEvalFormative : current.peerEvalSummative) ?? null}
        onChanged={refresh}
      />
    );
  const openRounds = ROUNDS.filter((r) => tm.rounds[r].status === "open");
  const laterRounds = ROUNDS.filter((r) => tm.rounds[r].status !== "open");

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
          {team && teamKey && (
            <NicknameCard
              codeIndex={roster.codeIndex}
              nicknames={nicknames}
              busy={savingNickname}
              onSave={saveNickname}
            />
          )}

          {openRounds.map(evalCard)}

          {/* Published results are the other reason a student logs in, so they
              sit with the open round rather than below the contract editor. */}
          {memberKey && tm.rounds.formative.resultsPublished && current.resultFormative && (
            <FormativeResults
              memberKey={memberKey}
              envelope={current.resultFormative}
              behaviors={tm.behaviors}
            />
          )}
          {memberKey && tm.rounds.summative.resultsPublished && current.resultSummative && (
            <FormativeResults
              memberKey={memberKey}
              envelope={current.resultSummative}
              behaviors={tm.behaviors}
            />
          )}

          <Card>
            <h2 className="mb-1 font-semibold">Your team — {roster.teamLabel}</h2>
            <ul className="text-sm text-slate-700">
              <li className="font-medium">{displayName(roster.codeIndex, nicknames)} (you)</li>
              {roster.teammates.map((t) => (
                <li key={t.codeIndex}>
                  {displayName(t.codeIndex, nicknames)}
                  {!nicknames[String(t.codeIndex)] && (
                    <span className="text-slate-500"> — hasn't chosen a display name yet</span>
                  )}
                </li>
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

          {laterRounds.map(evalCard)}
        </>
      )}

      <Card className="bg-indigo-50">
        <h2 className="mb-1 font-semibold">Your privacy</h2>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{config.privacyNote}</p>
      </Card>
    </div>
  );
}
