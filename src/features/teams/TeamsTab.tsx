import { useEffect, useMemo, useState } from "react";
import { useSession } from "../sessions/SessionContext";
import { getTeamDirectoryDoc, watchTeams } from "../../lib/db";
import { eciesDecrypt } from "../../lib/crypto";
import { downloadFile, sessionFilename } from "../../lib/util";
import type { ContractContent, TeamDirectory, TeamDoc } from "../../types";
import { Badge, Button, Card, ErrorText, Spinner } from "../../components/ui";
import { UnlockPanel } from "../sessions/UnlockPanel";
import { RosterImport } from "./RosterImport";
import { ContractPrint } from "./ContractPrint";

const STATUS_TONE = { empty: "gray", draft: "amber", final: "green" } as const;
const STATUS_LABEL = { empty: "Not started", draft: "In progress", final: "Finalized" } as const;

export function TeamsTab() {
  const { sid, session } = useSession();
  const [teams, setTeams] = useState<(TeamDoc & { tokenHash: string })[]>([]);
  useEffect(() => watchTeams(sid, setTeams), [sid]);

  const provisioned = session.teamMgmt?.rosterUploadedAt != null;

  if (!provisioned) {
    return (
      <div className="space-y-4">
        <Card>
          <h2 className="mb-1 font-semibold">Team management</h2>
          <p className="text-sm text-slate-600">
            Optionally continue using this session after allocation: teams write a contract (with AI feedback) and you
            run peer evaluations. Everything stays end-to-end encrypted — names are sealed per student under a key
            derived from their login code, so this platform never stores them in plaintext. Start by uploading the
            final team roster.
          </p>
        </Card>
        <RosterImport existingConfig={session.teamMgmt} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Team contracts</h2>
            <p className="text-sm text-slate-600">{teams.length} teams provisioned.</p>
          </div>
        </div>
      </Card>
      <ContractReview teams={teams} sid={sid} sessionTitle={session.title} publicKey={session.wrappedKeys} />
    </div>
  );
}

function ContractReview({
  teams,
  sid,
  sessionTitle,
  publicKey,
}: {
  teams: (TeamDoc & { tokenHash: string })[];
  sid: string;
  sessionTitle: string;
  publicKey: import("../../types").WrappedKeys;
}) {
  const { sessionKey, setSessionKey } = useSession();
  const [directory, setDirectory] = useState<TeamDirectory | null>(null);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState<{ label: string; content: ContractContent; finalizedAt: number | null } | null>(
    null,
  );

  useEffect(() => {
    if (!sessionKey) return;
    (async () => {
      try {
        const doc = await getTeamDirectoryDoc(sid);
        if (!doc) {
          setError("No team directory found — re-provision the roster.");
          return;
        }
        setDirectory(JSON.parse(await eciesDecrypt(sessionKey, doc.payload)) as TeamDirectory);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [sessionKey, sid]);

  const namesByHash = useMemo(() => {
    const m = new Map<string, string>();
    directory?.teams.forEach((t) => t.members.forEach((mem) => m.set(mem.codeHash, mem.name)));
    return m;
  }, [directory]);

  if (!sessionKey) {
    return (
      <UnlockPanel
        wrapped={publicKey}
        title="Unlock to read contracts"
        intro="Contracts are encrypted. Enter your session passphrase (or recovery key) to read them in this browser tab."
        onUnlocked={setSessionKey}
      />
    );
  }
  if (error) {
    return (
      <Card>
        <ErrorText>{error}</ErrorText>
      </Card>
    );
  }
  if (!directory) return <Spinner label="Decrypting team directory…" />;

  const teamsByLabel = new Map(directory.teams.map((t) => [t.label, t]));

  async function readContract(team: TeamDoc & { tokenHash: string }): Promise<ContractContent | null> {
    if (!team.contract.contentForInstructor || !sessionKey) return null;
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

  return (
    <>
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm text-slate-600">Click a team to read its contract and AI feedback.</p>
          <Button variant="secondary" onClick={downloadAll}>
            Download all contracts (.txt)
          </Button>
        </div>
        <div className="space-y-2">
          {teams.map((t) => {
            const members = teamsByLabel.get(t.teamLabel)?.members ?? [];
            return (
              <TeamCard
                key={t.tokenHash}
                team={t}
                memberNames={members.map((m) => namesByHash.get(m.codeHash) ?? `#${m.codeIndex}`)}
                readContract={readContract}
                onPrint={(content) =>
                  setPrinting({ label: t.teamLabel, content, finalizedAt: t.contract.finalizedAt })
                }
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
  memberNames,
  readContract,
  onPrint,
}: {
  team: TeamDoc & { tokenHash: string };
  memberNames: string[];
  readContract: (t: TeamDoc & { tokenHash: string }) => Promise<ContractContent | null>;
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
  return (
    <div className="rounded-md border border-slate-200">
      <button className="flex w-full items-center justify-between px-3 py-2 text-left" onClick={toggle}>
        <div>
          <span className="font-medium">{team.teamLabel}</span>
          <span className="ml-2 text-xs text-slate-500">{memberNames.join(", ")}</span>
        </div>
        <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-3 py-2">
          {loading && <Spinner label="Decrypting contract…" />}
          <ErrorText>{err}</ErrorText>
          {!loading && !content && <p className="text-sm text-slate-500">No contract submitted yet.</p>}
          {content && (
            <div className="space-y-3">
              {content.sections.map((s) => (
                <div key={s.id}>
                  <h4 className="text-sm font-semibold">{s.title}</h4>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{s.text.trim() || "—"}</p>
                </div>
              ))}
              <Button variant="secondary" onClick={() => onPrint(content)}>
                Print / Save as PDF
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
