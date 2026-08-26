const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Random id from a 36-character alphabet.
 *
 * Rejection sampling rather than a bare `% 36`: 256 is not a multiple of 36, so
 * modulo alone would over-represent the first four letters by about 9%. Login
 * codes (lib/codes.ts) sidestep the same trap by using a 32-character alphabet,
 * which divides 256 exactly.
 */
export function randomId(length = 12): string {
  const limit = 256 - (256 % ID_ALPHABET.length); // 252
  let id = "";
  while (id.length < length) {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= limit) continue; // biased tail — draw again
      id += ID_ALPHABET[b % ID_ALPHABET.length];
      if (id.length === length) break;
    }
  }
  return id;
}

/**
 * Byte-order mark, prepended to CSV downloads.
 *
 * Excel on Windows opens a UTF-8 CSV as ANSI unless the file starts with one,
 * which mangles every non-Latin display name — the same text the contract PDF
 * goes out of its way to preserve. parseCsv strips it again on the way back in.
 */
export const UTF8_BOM = "﻿";

export function downloadFile(filename: string, content: string, mime = "text/plain"): void {
  const body = mime.startsWith("text/csv") && !content.startsWith(UTF8_BOM) ? UTF8_BOM + content : content;
  const blob = new Blob([body], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  // Firefox only follows a click on an anchor that is in the document, and
  // revoking the URL synchronously can cancel a download that has not started.
  // That matters most at session creation, where two files are saved back to
  // back and the second one is the unrecoverable recovery key.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Characters that make a spreadsheet treat a cell as a formula.
 *
 * Student-supplied text reaches these exports — chosen display names,
 * peer-evaluation justifications, confidential comments — and opening them in
 * Excel is the instructor's expected workflow, so a cell that starts with one
 * of these is prefixed with an apostrophe. Spreadsheets strip the apostrophe on
 * display and treat the rest as text.
 */
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

export function escapeCsvCell(value: string | number): string {
  const s = String(value);
  const guarded = s.length > 0 && FORMULA_TRIGGERS.includes(s[0]) ? `'${s}` : s;
  // \r as well as \n: a lone CR ends the row for Excel and for parseCsv below,
  // so an unquoted one would let injected text forge extra rows.
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

/** Inverse of toCsv: handles quoted cells, escaped quotes, CRLF/LF, and
 * newlines inside quotes. Skips fully empty trailing lines.
 *
 * Strips a leading byte-order mark first. Our own CSV downloads carry one (see
 * UTF8_BOM) and the login-codes CSV is handed straight back to the roster
 * importer, so without this the first header would read as U+FEFF followed by
 * "studentIndex" and no column would match. */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith(UTF8_BOM) ? input.slice(UTF8_BOM.length) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
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
