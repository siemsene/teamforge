import { describe, expect, it } from "vitest";
import { contractPdfName } from "../src/lib/printPdf";

/**
 * Browsers take the "Save as PDF" filename from document.title, so this is what
 * a student ends up with in their downloads folder. Without it every team's
 * contract saved as some variant of "TeamForge.pdf".
 */
describe("contractPdfName", () => {
  it("names the file for the course and the team", () => {
    expect(contractPdfName("MGMT 4500, Spring 2027", "Team 3")).toBe(
      "Team Contract - MGMT 4500, Spring 2027 - Team 3",
    );
  });

  it("strips characters a filesystem would reject", () => {
    // A project name with a slash or colon is entirely plausible as a team label.
    expect(contractPdfName("Ops/Analytics: Sec 2", 'Riverside "Museum"')).toBe(
      "Team Contract - Ops Analytics Sec 2 - Riverside Museum",
    );
    expect(contractPdfName("A\\B", "C|D")).toBe("Team Contract - A B - C D");
  });

  it("keeps hyphens and commas, which are legal and carry meaning", () => {
    expect(contractPdfName("MGMT-4500", "Team A-1")).toBe("Team Contract - MGMT-4500 - Team A-1");
  });

  it("collapses the whitespace left behind by stripping", () => {
    expect(contractPdfName("A  /  B", "Team   7")).toBe("Team Contract - A B - Team 7");
  });

  it("drops empty parts rather than leaving a dangling separator", () => {
    expect(contractPdfName("", "Team 3")).toBe("Team Contract - Team 3");
    expect(contractPdfName("MGMT 4500", "")).toBe("Team Contract - MGMT 4500");
    expect(contractPdfName("///", "|||")).toBe("Team Contract");
  });

  it("stays within a sane filename length", () => {
    const name = contractPdfName("x".repeat(200), "y".repeat(200));
    expect(name.length).toBeLessThanOrEqual(120);
  });

  it("leaves non-Latin text alone — printing is what preserves it", () => {
    // The reason this stayed a print dialog rather than a bundled PDF library:
    // the standard PDF fonts cannot render these at all.
    expect(contractPdfName("Análisis de Equipos", "Grupo Ñ")).toBe(
      "Team Contract - Análisis de Equipos - Grupo Ñ",
    );
    expect(contractPdfName("チーム", "第3班")).toBe("Team Contract - チーム - 第3班");
  });
});
