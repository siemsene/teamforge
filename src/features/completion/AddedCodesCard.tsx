import { downloadFile } from "../../lib/util";
import { Button, Card } from "../../components/ui";
import type { AddedCodes } from "./addStudentsFlow";

/**
 * The one-time codes for students just added. Mirrors the bundle session
 * creation hands over: dismissed only once the instructor confirms they saved
 * it, because nothing else holds these codes.
 *
 * `appendHint` is the Roster tab's reminder to append the rows to the master
 * codes CSV. The Teams tab, which places the student on a team in the same
 * step, does not need the instructor to re-upload anything, so it leaves it off.
 */
export function AddedCodesCard({
  added,
  onDismiss,
  appendHint = true,
}: {
  added: AddedCodes;
  onDismiss: () => void;
  appendHint?: boolean;
}) {
  const many = added.lastIndex !== added.firstIndex;
  return (
    <Card>
      {added.incomplete ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">These students may only be partly added.</p>
          <p className="mt-1">Saving them failed: {added.incomplete}</p>
          <p className="mt-1">
            <strong>Save the file anyway.</strong> It holds the only copy of these login codes. Then check the roster:
            if the new numbers are not there, add them again and discard this file.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-medium">
            Added {added.lastIndex - added.firstIndex + 1} student{many ? "s" : ""} (#{added.firstIndex}
            {many ? `–#${added.lastIndex}` : ""}).
          </p>
          <p className="mt-1">
            Save this file now — login codes are not stored in plaintext and cannot be recovered after you leave this
            screen.
          </p>
          {appendHint ? (
            <p className="mt-1">
              <strong>Append these rows to the master codes CSV</strong> you saved when you created the session. If you
              ever re-upload the roster on the Teams tab, it needs one file covering the whole class; uploading only
              these rows would delete every team that is not in it.
            </p>
          ) : (
            <p className="mt-1">
              Keep these rows with the master codes CSV you saved when you created the session, so you can match the
              number to the student later.
            </p>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => downloadFile(added.filename, added.csv, "text/csv")}>
          Download again
        </Button>
        <Button onClick={onDismiss}>I saved the file</Button>
      </div>
    </Card>
  );
}
