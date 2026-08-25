import { describe, expect, it } from "vitest";
import { fileSlug, parseCsv, sessionFilename, toCsv } from "../src/lib/util";

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
