// pdfkit's built-in fonts (Helvetica and friends) are limited to WinAnsi
// encoding. Hand them a character outside it — a Greek letter, a true minus
// sign, a maths operator — and they emit a wrong glyph instead of failing, so
// the damage only shows up when somebody opens the PDF.
//
// `guardPdfText` wraps doc.text so an unencodable character throws at
// generation time, naming the character and the string it came from. Prefer an
// ASCII spelling ("delta", "-", ">=") over reaching for the symbol; embedding a
// Unicode TTF would work too, but nothing here has needed one yet.

/** ASCII, Latin-1, and the printable characters WinAnsi maps into 0x80-0x9F. */
const WINANSI_SPECIALS =
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ" +
  "‘’“”•–—˜™š›œžŸ";

export function isEncodable(ch) {
  if (ch === "\n" || ch === "\r" || ch === "\t") return true;
  const code = ch.codePointAt(0);
  if (code >= 0x20 && code <= 0x7e) return true; // ASCII
  if (code >= 0xa0 && code <= 0xff) return true; // Latin-1 supplement
  return WINANSI_SPECIALS.includes(ch);
}

/** Returns the unencodable characters in `text`, deduplicated. */
export function unencodable(text) {
  const bad = new Set();
  for (const ch of String(text)) if (!isEncodable(ch)) bad.add(ch);
  return [...bad];
}

/** Wraps doc.text so unencodable characters fail loudly instead of silently. */
export function guardPdfText(doc, label = "PDF") {
  const original = doc.text.bind(doc);
  doc.text = (text, ...rest) => {
    if (typeof text === "string") {
      const bad = unencodable(text);
      if (bad.length > 0) {
        const named = bad
          .map((c) => `"${c}" (U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")})`)
          .join(", ");
        throw new Error(
          `${label}: ${named} cannot be encoded by pdfkit's built-in fonts and would render as the wrong glyph.\n` +
            `Use an ASCII spelling instead (e.g. "delta", "-", ">=").\n` +
            `  in: ${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`,
        );
      }
    }
    return original(text, ...rest);
  };
  return doc;
}
