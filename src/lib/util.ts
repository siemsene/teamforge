const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomId(length = 12): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let id = "";
  for (let i = 0; i < length; i++) id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return id;
}

export function downloadFile(filename: string, content: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}

export function surveyUrl(sid: string): string {
  return `${window.location.origin}/s/${sid}`;
}

/** Filesystem-safe slug of a session title, for use in download filenames. */
export function fileSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "") // drop punctuation/accents
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return slug || "session";
}

/**
 * Download filename combining the readable session title with a short slice of
 * the session id, so files are recognizable yet unique across same-named
 * sessions. e.g. sessionFilename("MGMT 4500", "abc123def456", "teams.csv")
 * -> "mgmt-4500-abc123-teams.csv".
 */
export function sessionFilename(title: string, sid: string, suffix: string): string {
  return `${fileSlug(title)}-${sid.slice(0, 6)}-${suffix}`;
}
