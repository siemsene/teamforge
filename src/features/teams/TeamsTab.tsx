import { useEffect, useMemo, useState } from "react";
import { useSession } from "../sessions/SessionContext";
import { watchTeams } from "../../lib/db";
import { eciesDecrypt } from "../../lib/crypto";
import { openDirectoryNicknames } from "../../lib/nicknames";
import { downloadFile, sessionFilename } from "../../lib/util";
import type { ContractContent, Nicknames, TeamDirectory, TeamDoc } from "../../types";
import { Badge, Button, Card, ErrorText, Spinner } from "../../components/ui";
import { UnlockPanel } from "../sessions/UnlockPanel";
import { rosterStaleness } from "../sessions/rosterStaleness";
import { RosterImport } from "./RosterImport";
import { ContractPrint } from "./ContractPrint";
import { contractPdfName, printAs } from "../../lib/printPdf";
import { EmailTemplateCard } from "../../components/EmailTemplateCard";
import { contractEmail, emailContext } from "./emailTemplates";
import { CONTRACT_SECTIONS, publicTeamMgmt } from "./contractTemplate";
import { resolveFactorParams } from "../../lib/teamFactor";
import { saveTeamMgmt } from "../../lib/db";
import { surveyUrl } from "../../lib/util";
import { removalConsequences } from "../completion/rosterEdit";
import { AddedCodesCard } from "../completion/AddedCodesCard";
import { useTeamDirectory } from "./useTeamDirectory";
import { useTeamEdits } from "./useTeamEdits";
import { teamEditWarnings, type LiveStudent, type TeamEdit, type TeamEditContext } from "./teamEdit";
import {
  AddStudentDialog,
  DeleteTeamDialog,
  MoveMemberDialog,
  RemoveMemberDialog,
  type MemberRef,
} from "./TeamEditDialogs";

const STATUS_TONE = { empty: "gray", draft: "amber", final: "green" } as const;
const STATUS_LABEL = { empty: "Not started", draft: "In progress", final: "Finalized" } as const;

type LoadedTeam = TeamDoc & { tokenHash: string };

type Dialog =
  | { kind: "move"; member: MemberRef; fromLabel: string }
  | { kind: "remove"; member: MemberRef }
  | { kind: "add"; toLabel?: string; student?: LiveStudent }
  | { kind: "deleteTeam"; label: string };

/** Callbacks a team card uses to open the edit dialogs. */
interface TeamActions {
  enabled: boolean;
  onMove: (member: MemberRef, fromLabel: string) => void;
  onRemove: (member: MemberRef) => void;
  onAdd: (toLabel: string) => void;
  onDeleteTeam: (label: string) => void;
}

export function TeamsTab() {
  const { sid, session, students, sessionKey, setSessionKey, allocationUpdatedAt } = useSession();
  const [teams, setTeams] = useState<LoadedTeam[]>([]);
  const [reuploading, setReuploading] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  useEffect(() => watchTeams(sid, setTeams), [sid]);

  const provisioned = session.teamMgmt?.rosterUploadedAt != null;
  const stale = rosterStaleness(session, null); // only teamRosterStale is read here

  const dir = useTeamDirectory(sid, provisioned ? sessionKey : null);
  const edits = useTeamEdits({ sid, session, students, directory: dir.directory, setDirectory: dir.setDirectory });

  if (!provisioned) {
    return (
      <div className="space-y-4">
        <Card>
          <h2 className="mb-1 font-semibold">Team management</h2>
          <p className="text-sm text-slate-600">
            Optionally continue using this session after allocation: teams write a contract (with AI feedback) and you
            run peer evaluations. Teams come from the allocation you already saved — you just re-supply the
            login-codes CSV, because each student&rsquo;s team is sealed under a key derived from their own code and
            those codes are never stored. No names are uploaded; each student picks the display name you and their
            team will see.
          </p>
        </Card>
        <RosterImport existingConfig={session.teamMgmt} />
      </div>
    );
  }

  const labels = dir.directory?.teams.map((t) => t.label) ?? [];

  /** What the confirm dialogs need to say what an edit will do. */
  function contextFor(hash?: string): TeamEditContext | null {
    if (!edits.base || !session.teamMgmt) return null;
    const student = hash ? students.find((s) => s.hash === hash) : undefined;
    const rounds = session.teamMgmt.rounds;
    return {
      teams: edits.base.teams,
      sessionStatus: session.status,
      rounds: {
        formative: { status: rounds.formative.status, resultsPublished: rounds.formative.resultsPublishedAt != null },
        summative: { status: rounds.summative.status, resultsPublished: rounds.summative.resultsPublishedAt != null },
      },
      contractStatus: new Map(teams.map((t) => [t.teamLabel, t.contract.status])),
      submitted: student
        ? { formative: !!student.peerEvalFormative, summative: !!student.peerEvalSummative }
        : undefined,
    };
  }
  function warningsFor(edit: TeamEdit, hash?: string) {
    const ctx = contextFor(hash);
    return ctx ? teamEditWarnings(edit, ctx) : [];
  }

  const actions: TeamActions = {
    enabled: edits.canEdit,
    onMove: (member, fromLabel) => setDialog({ kind: "move", member, fromLabel }),
    onRemove: (member) => setDialog({ kind: "remove", member }),
    onAdd: (toLabel) => setDialog({ kind: "add", toLabel }),
    onDeleteTeam: (label) => setDialog({ kind: "deleteTeam", label }),
  };

  async function finish(ok: boolean) {
    if (ok) setDialog(null);
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Team contracts</h2>
            <p className="text-sm text-slate-600">
              {teams.length} teams provisioned
              {session.teamMgmt?.rosterUploadedAt != null &&
                ` on ${new Date(session.teamMgmt.rosterUploadedAt).toLocaleDateString()}`}
              .
            </p>
          </div>
          {/* Teams change: a student enrols late, or you move somebody by hand.
              Both are done on this tab; the re-upload remains for wholesale
              changes, and keeps each unchanged team's contract and display names. */}
          <Button variant="secondary" onClick={() => setReuploading((v) => !v)}>
            {reuploading ? "Cancel" : "Re-upload the whole roster"}
          </Button>
        </div>
        {stale.teamRosterStale && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              Your roster has changed since these teams were last updated. Until the teams are updated, a student who
              was removed still appears on their teammates&rsquo; peer evaluations — and keeps the key to their
              team&rsquo;s contract — and a student who was added is on no team.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void edits.run({ type: "sync" })}
                disabled={!edits.canEdit}
                title={!sessionKey ? "Unlock below first" : undefined}
              >
                {edits.busy ? "Updating…" : "Update teams now"}
              </Button>
              {!sessionKey && <span className="text-xs">Unlock with your passphrase below first.</span>}
            </div>
          </div>
        )}
        {edits.progress && (
          <p className="mt-2 text-xs text-slate-500">
            Re-sealing rosters in your browser… {edits.progress.done}/{edits.progress.total}
          </p>
        )}
        {!dialog && <ErrorText>{edits.error}</ErrorText>}
      </Card>

      {edits.added && <AddedCodesCard added={edits.added} onDismiss={edits.dismissAdded} appendHint={false} />}

      {reuploading && <RosterImport existingConfig={session.teamMgmt} onDone={() => setReuploading(false)} />}
      <ContractEmailCard />

      {!sessionKey ? (
        <UnlockPanel
          wrapped={session.wrappedKeys}
          title="Unlock to read contracts and change teams"
          intro="Contracts and the team directory are encrypted. Enter your session passphrase (or recovery key) to read them, and to add, move or remove students, in this browser tab."
          onUnlocked={setSessionKey}
        />
      ) : dir.error ? (
        <Card>
          <ErrorText>{dir.error}</ErrorText>
        </Card>
      ) : !dir.directory || !edits.base ? (
        <Spinner label="Decrypting team directory…" />
      ) : (
        <>
          {edits.base.missingKey.length > 0 && (
            <Card className="border-amber-200 bg-amber-50">
              <p className="text-sm text-amber-900">
                These teams were provisioned before TeamForge kept each student&rsquo;s key, so they cannot be changed
                here one student at a time. Re-upload the whole login-codes CSV once; after that, adding, moving and
                removing students works from this tab.
              </p>
            </Card>
          )}
          <UnassignedCard
            students={edits.unassigned}
            enabled={edits.canEdit}
            onPlace={(student) => setDialog({ kind: "add", student })}
            onAddNew={() => setDialog({ kind: "add" })}
          />
          <ContractReview
            teams={teams}
            directory={dir.directory}
            sid={sid}
            sessionTitle={session.title}
            sessionKey={sessionKey}
            actions={actions}
          />
        </>
      )}

      {dialog?.kind === "move" && (
        <MoveMemberDialog
          open
          member={dialog.member}
          fromLabel={dialog.fromLabel}
          labels={labels}
          warningsFor={(toLabel) => warningsFor({ type: "move", codeHash: dialog.member.codeHash, toLabel }, dialog.member.codeHash)}
          busy={edits.busy}
          error={edits.error}
          onCancel={() => setDialog(null)}
          onConfirm={(toLabel) => void edits.run({ type: "move", codeHash: dialog.member.codeHash, toLabel }).then(finish)}
        />
      )}
      {dialog?.kind === "remove" && (
        <RemoveMemberDialog
          open
          member={dialog.member}
          consequences={removalConsequences(
            students.filter((s) => s.hash === dialog.member.codeHash),
            { allocationSaved: allocationUpdatedAt != null },
          )}
          warnings={warningsFor({ type: "remove", codeHash: dialog.member.codeHash }, dialog.member.codeHash)}
          busy={edits.busy}
          error={edits.error}
          onCancel={() => setDialog(null)}
          onConfirm={() => void edits.removeFromSession(dialog.member).then(finish)}
        />
      )}
      {dialog?.kind === "add" && (
        <AddStudentDialog
          open
          labels={labels}
          initialLabel={dialog.toLabel}
          student={dialog.student}
          warningsFor={(toLabel) =>
            warningsFor({
              type: "add",
              member: { codeIndex: dialog.student?.codeIndex ?? -1, codeHash: dialog.student?.hash ?? "" },
              toLabel,
            })
          }
          busy={edits.busy}
          error={edits.error}
          onCancel={() => setDialog(null)}
          onConfirm={(choice, toLabel) =>
            void (choice.mode === "mint" ? edits.addNewStudent(toLabel) : edits.placeByCode(choice.code, toLabel)).then(
              finish,
            )
          }
        />
      )}
      {dialog?.kind === "deleteTeam" && (
        <DeleteTeamDialog
          open
          label={dialog.label}
          busy={edits.busy}
          error={edits.error}
          onCancel={() => setDialog(null)}
          onConfirm={() => void edits.run({ type: "deleteTeam", label: dialog.label }).then(finish)}
        />
      )}
    </div>
  );
}

function ContractEmailCard() {
  const { sid, session } = useSession();
  const tm = session.teamMgmt;
  if (!tm) return null;
  const params = resolveFactorParams(tm);
  const ctx = emailContext(
    session.title,
    surveyUrl(sid),
    { ...params, includeBehaviors: tm.includeBehaviors, aiFeedbackEnabled: tm.aiFeedbackEnabled },
    CONTRACT_SECTIONS.map((c) => c.title),
  );
  return (
    <EmailTemplateCard
      title="Email to students — teams and the contract"
      intro="Tells students their team is set, how to log in, that they pick their own display name, and what the contract has to cover."
      saved={tm.contractEmail}
      fallback={contractEmail(ctx)}
      onSave={async (contractEmailText) => {
        const next = { ...tm, contractEmail: contractEmailText };
        await saveTeamMgmt(sid, next, publicTeamMgmt(next));
      }}
    />
  );
}

/** Students on the roster whom no team lists — added on the Roster tab after
 * provisioning, or left over from a placement that failed halfway. */
function UnassignedCard({
  students,
  enabled,
  onPlace,
  onAddNew,
}: {
  students: LiveStudent[];
  enabled: boolean;
  onPlace: (s: LiveStudent) => void;
  onAddNew: () => void;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Students and teams</h3>
          <p className="text-sm text-slate-600">
            {students.length === 0
              ? "Every student on the roster is on a team."
              : `${students.length} student${students.length === 1 ? " is" : "s are"} on no team: ${students
                  .map((s) => `#${s.codeIndex}`)
                  .join(", ")}.`}
          </p>
        </div>
        <Button onClick={onAddNew} disabled={!enabled}>
          Add a student
        </Button>
      </div>
      {students.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {students.map((s) => (
            <Button key={s.hash} variant="secondary" disabled={!enabled} onClick={() => onPlace(s)}>
              Place #{s.codeIndex} on a team
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}

function ContractReview({
  teams,
  directory,
  sid,
  sessionTitle,
  sessionKey,
  actions,
}: {
  teams: LoadedTeam[];
  directory: TeamDirectory;
  sid: string;
  sessionTitle: string;
  sessionKey: CryptoKey;
  actions: TeamActions;
}) {
  const [nicknames, setNicknames] = useState<Nicknames>({});
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState<{ label: string; content: ContractContent; finalizedAt: number | null } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Team docs are already loaded here, so resolve nicknames from them
        // rather than re-fetching each one.
        const byTokenHash = new Map(teams.map((t) => [t.tokenHash, t]));
        const names = await openDirectoryNicknames(sid, directory.teams, async (tokenHash) => byTokenHash.get(tokenHash) ?? null);
        if (!cancelled) setNicknames(names);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sid, directory, teams]);

  const teamsByLabel = useMemo(() => new Map(directory.teams.map((t) => [t.label, t])), [directory]);

  async function readContract(team: LoadedTeam): Promise<ContractContent | null> {
    if (!team.contract.contentForInstructor) return null;
    return JSON.parse(await eciesDecrypt(sessionKey, team.contract.contentForInstructor)) as ContractContent;
  }

  async function downloadAll() {
    const parts: string[] = [];
    for (const t of teams) {
      const content = await readContract(t).catch(() => null);
      parts.push(`# ${t.teamLabel}\n`);
      if (content) {
        for (const s of content.sections) parts.push(`## ${s.title}\n${s.text.trim() || "—"}\n`);
      } else {
        parts.push("(no contract submitted)\n");
      }
      parts.push("\n");
    }
    downloadFile(sessionFilename(sessionTitle, sid, "contracts.txt"), parts.join("\n"), "text/plain");
  }

  const memberRef = (m: { codeIndex: number; codeHash: string }): MemberRef => ({
    codeHash: m.codeHash,
    codeIndex: m.codeIndex,
    name: nicknames[String(m.codeIndex)] ? `${nicknames[String(m.codeIndex)]} (#${m.codeIndex})` : `#${m.codeIndex}`,
  });

  return (
    <>
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm text-slate-600">
            Click a team to read its contract, and to add, move or remove its members.
          </p>
          <Button variant="secondary" onClick={downloadAll}>
            Download all contracts (.txt)
          </Button>
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="space-y-2">
          {teams.map((t) => {
            const entry = teamsByLabel.get(t.teamLabel);
            return (
              <TeamCard
                key={t.tokenHash}
                team={t}
                members={(entry?.members ?? []).map(memberRef)}
                inDirectory={entry != null}
                hasNickname={(idx) => !!nicknames[String(idx)]}
                readContract={readContract}
                actions={actions}
                onPrint={(content) => {
                  setPrinting({ label: t.teamLabel, content, finalizedAt: t.contract.finalizedAt });
                  setTimeout(() => printAs(contractPdfName(sessionTitle, t.teamLabel)), 50);
                }}
              />
            );
          })}
        </div>
      </Card>
      {printing && (
        <ContractPrint
          sessionTitle={sessionTitle}
          teamLabel={printing.label}
          content={printing.content}
          finalizedAt={printing.finalizedAt}
        />
      )}
    </>
  );
}

function TeamCard({
  team,
  members,
  inDirectory,
  hasNickname,
  readContract,
  actions,
  onPrint,
}: {
  team: LoadedTeam;
  members: MemberRef[];
  /** False for a team doc the directory no longer lists (should not happen;
   * shown rather than hidden so it can be noticed). */
  inDirectory: boolean;
  hasNickname: (codeIndex: number) => boolean;
  readContract: (t: LoadedTeam) => Promise<ContractContent | null>;
  actions: TeamActions;
  onPrint: (content: ContractContent) => void;
}) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<ContractContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!content && team.contract.contentForInstructor) {
      setLoading(true);
      try {
        setContent(await readContract(team));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
  }

  const status = team.contract.status;
  const summary =
    members.length === 0 ? (inDirectory ? "no members" : "not in the team directory") : members.map((m) => m.name).join(", ");
  return (
    <div className="rounded-md border border-slate-200">
      <button className="flex w-full items-center justify-between px-3 py-2 text-left" onClick={toggle} aria-expanded={open}>
        <div>
          <span className="font-medium">{team.teamLabel}</span>
          <span className="ml-2 text-xs text-slate-500">{summary}</span>
        </div>
        <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 px-3 py-2">
          <div>
            <h4 className="mb-1 text-sm font-semibold">Members</h4>
            {members.length === 0 && <p className="text-sm text-slate-500">Nobody is on this team.</p>}
            <ul className="divide-y divide-slate-100 text-sm">
              {members.map((m) => (
                <li key={m.codeHash} className="flex flex-wrap items-center justify-between gap-2 py-1">
                  <span>
                    {m.name}
                    {!hasNickname(m.codeIndex) && <span className="text-slate-500"> — no display name yet</span>}
                  </span>
                  <span className="flex gap-1">
                    <Button variant="ghost" disabled={!actions.enabled} onClick={() => actions.onMove(m, team.teamLabel)}>
                      Move…
                    </Button>
                    <Button variant="ghost" disabled={!actions.enabled} onClick={() => actions.onRemove(m)}>
                      Remove from session…
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" disabled={!actions.enabled} onClick={() => actions.onAdd(team.teamLabel)}>
                Add a student to this team
              </Button>
              {members.length === 0 && inDirectory && (
                <Button variant="danger" disabled={!actions.enabled} onClick={() => actions.onDeleteTeam(team.teamLabel)}>
                  Delete team
                </Button>
              )}
            </div>
          </div>
          <div>
            <h4 className="mb-1 text-sm font-semibold">Contract</h4>
            {loading && <Spinner label="Decrypting contract…" />}
            <ErrorText>{err}</ErrorText>
            {!loading && !content && <p className="text-sm text-slate-500">No contract submitted yet.</p>}
            {content && (
              <div className="space-y-3">
                {content.sections.map((s) => (
                  <div key={s.id}>
                    <h5 className="text-sm font-semibold">{s.title}</h5>
                    <p className="whitespace-pre-wrap text-sm text-slate-700">{s.text.trim() || "—"}</p>
                  </div>
                ))}
                <Button variant="secondary" onClick={() => onPrint(content)}>
                  Print / Save as PDF
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

