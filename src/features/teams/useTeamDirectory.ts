import { useCallback, useEffect, useState } from "react";
import { getTeamDirectoryDoc } from "../../lib/db";
import { eciesDecrypt } from "../../lib/crypto";
import type { TeamDirectory } from "../../types";

/**
 * The decrypted team directory for the Teams tab, shared between the contract
 * list and the membership edits. Every edit rebuilds the directory and hands
 * the new one straight to `setDirectory`, so nothing has to be decrypted twice.
 */
export function useTeamDirectory(sid: string, sessionKey: CryptoKey | null) {
  const [directory, setDirectory] = useState<TeamDirectory | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!sessionKey) {
      setDirectory(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const doc = await getTeamDirectoryDoc(sid);
        if (cancelled) return;
        if (!doc) {
          setError("No team directory found — re-provision the roster.");
          return;
        }
        const dir = JSON.parse(await eciesDecrypt(sessionKey, doc.payload)) as TeamDirectory;
        if (cancelled) return;
        setDirectory(dir);
        setError("");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sid, sessionKey, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { directory, setDirectory, error, reload };
}
