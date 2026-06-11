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
