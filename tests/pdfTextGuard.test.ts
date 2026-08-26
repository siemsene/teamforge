import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs build script, no type declarations
import { guardPdfText, isEncodable, unencodable } from "../scripts/pdf-text-guard.mjs";

/** Stands in for a pdfkit document: records what would have been drawn. */
function fakeDoc() {
  const drawn: string[] = [];
  return { drawn, text: (s: string) => (drawn.push(s), s) };
}

describe("pdf text guard", () => {
  it("accepts everything the built-in fonts can encode", () => {
    const safe = [
      "f = clip(1 + k * sign(d) * max(0, |d| - delta), floor, ceiling)",
      "100 ÷ (team size - 1)", // Latin-1
      "0.80–1.10 and 1–5", // en dash
      "an em dash — and “curly quotes” and an apostrophe’s tail", // WinAnsi specials
      "±0.08, µ, °, ½, ×, ·",
    ];
    for (const s of safe) expect(unencodable(s)).toEqual([]);
  });

  it("rejects the characters that silently rendered as the wrong glyph", () => {
    // The actual regression: a Greek delta and a true minus sign reached the
    // instructor guide and pdfkit drew something else entirely.
    expect(unencodable("dead band δ")).toEqual(["δ"]);
    expect(unencodable("|d| − 1")).toEqual(["−"]); // U+2212, not a hyphen
    expect(unencodable("r ≥ 3 and ν and →")).toEqual(["≥", "ν", "→"]);
    expect(isEncodable("δ")).toBe(false);
    expect(isEncodable("-")).toBe(true);
  });

  it("throws at generation time, naming the character and its context", () => {
    const doc = fakeDoc();
    guardPdfText(doc, "instructor-guide.pdf");
    expect(() => doc.text("the dead band δ applies")).toThrowError(/U\+03B4/);
    expect(() => doc.text("the dead band δ applies")).toThrowError(/instructor-guide\.pdf/);
    expect(() => doc.text("the dead band δ applies")).toThrowError(/the dead band/);
    expect(doc.drawn).toEqual([]); // nothing was written
  });

  it("passes safe text straight through to the document", () => {
    const doc = fakeDoc();
    guardPdfText(doc);
    doc.text("delta = 0.08, k = 0.5");
    expect(doc.drawn).toEqual(["delta = 0.08, k = 0.5"]);
  });

  it("leaves newlines and non-string arguments alone", () => {
    const doc = fakeDoc();
    guardPdfText(doc);
    expect(() => doc.text("line one\nline two\ttabbed")).not.toThrow();
    expect(() => (doc.text as (v: unknown) => unknown)(42)).not.toThrow();
  });
});
