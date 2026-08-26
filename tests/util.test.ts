import { describe, expect, it } from "vitest";
import { UTF8_BOM, fileSlug, parseCsv, randomId, sessionFilename, toCsv } from "../src/lib/util";

describe("fileSlug", () => {
  it("lowercases and hyphenates titles", () => {
    expect(fileSlug("MGMT 4500 Spring 2027")).toBe("mgmt-4500-spring-2027");
  });

  it("strips punctuation and collapses separators", () => {
    expect(fileSlug("  Bob's Team / Section #2!! ")).toBe("bobs-team-section-2");
  });

  it("falls back to 'session' when nothing usable remains", () => {
    expect(fileSlug("   ")).toBe("session");
    expect(fileSlug("!@#$%")).toBe("session");
  });

  it("caps length to keep filenames sane", () => {
    expect(fileSlug("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("parseCsv", () => {
  it("round-trips toCsv output including quotes, commas, and newlines", () => {
    const rows = [
      ["code", "name", "team"],
      ["ABCDE-FGHJK", 'Anna "Ace" O\'Neil, Jr.', "Team 1"],
      ["MNPQR-STVWX", "Multi\nline", "Team 2"],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows.map((r) => r.map(String)));
  });

  it("handles LF-only files and skips blank lines", () => {
    expect(parseCsv("a,b\n\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps empty cells inside non-empty rows", () => {
    expect(parseCsv("a,,c")).toEqual([["a", "", "c"]]);
  });
});

describe("sessionFilename", () => {
  it("combines the title slug with a short session id and suffix", () => {
    expect(sessionFilename("MGMT 4500", "abc123def456", "teams.csv")).toBe("mgmt-4500-abc123-teams.csv");
  });

  it("disambiguates same-named sessions by their id", () => {
    const a = sessionFilename("Capstone", "aaaaaa000000", "teams.csv");
    const b = sessionFilename("Capstone", "bbbbbb000000", "teams.csv");
    expect(a).not.toBe(b);
  });
});

describe("toCsv formula injection", () => {
  // Display names, peer-eval justifications and confidential comments are all
  // written by students and all land in CSVs the instructor opens in Excel.
  it("neutralises cells a spreadsheet would execute", () => {
    expect(toCsv([["=1+1"]])).toBe("'=1+1");
    expect(toCsv([["+SUM(A1)"]])).toBe("'+SUM(A1)");
    expect(toCsv([["-2+3"]])).toBe("'-2+3");
    expect(toCsv([["@SUM(A1)"]])).toBe("'@SUM(A1)");
  });

  it("neutralises the classic command-execution payload", () => {
    const cell = '=cmd|\' /c calc\'!A1';
    const out = toCsv([[cell]]);
    expect(out.startsWith("'=")).toBe(true);
  });

  it("leaves ordinary text and negative numbers-as-text alone", () => {
    expect(toCsv([["Alex R."]])).toBe("Alex R.");
    expect(toCsv([[-5]])).toBe("'-5"); // a leading '-' is guarded whatever produced it
    expect(toCsv([[42]])).toBe("42");
    expect(toCsv([[""]])).toBe("");
  });

  it("quotes a lone carriage return, which would otherwise forge a row", () => {
    const out = toCsv([["a\rb", "c"]]);
    expect(out).toBe('"a\rb",c');
    expect(parseCsv(out)).toEqual([["a\rb", "c"]]);
  });

  it("still quotes commas, quotes and newlines", () => {
    expect(toCsv([['a,b', 'say "hi"', "line1\nline2"]])).toBe('"a,b","say ""hi""","line1\nline2"');
  });
});

describe("CSV byte-order mark", () => {
  it("parseCsv strips a leading BOM so our own downloads re-import", () => {
    const withBom = UTF8_BOM + "code,index\r\nABC12-DE345,1";
    expect(parseCsv(withBom)[0]).toEqual(["code", "index"]);
  });

  it("parseCsv is unchanged for input without one", () => {
    expect(parseCsv("code,index\r\nX,1")).toEqual([
      ["code", "index"],
      ["X", "1"],
    ]);
  });
});

describe("randomId", () => {
  it("produces ids of the requested length from the expected alphabet", () => {
    for (const n of [1, 12, 30]) {
      const id = randomId(n);
      expect(id).toHaveLength(n);
      expect(id).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("draws roughly uniformly — a bare % 36 favours the first four letters", () => {
    // 256 = 7*36 + 4, so an unfiltered modulo gives a-d 8/256 of the draws and
    // every other character 7/256: a ~14% excess. Rejection sampling removes it.
    const counts = new Map<string, number>();
    for (let i = 0; i < 400; i++) {
      for (const ch of randomId(30)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const expected = total / 36;
    const head = ["a", "b", "c", "d"].reduce((a, c) => a + (counts.get(c) ?? 0), 0) / 4;
    // Generous band: this is a bias check, not a randomness test.
    expect(head).toBeGreaterThan(expected * 0.85);
    expect(head).toBeLessThan(expected * 1.15);
  });
});
