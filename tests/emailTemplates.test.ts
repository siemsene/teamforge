import { describe, expect, it } from "vitest";
import {
  contractEmail,
  emailContext,
  peerEvalEmail,
  type EmailContext,
} from "../src/features/teams/emailTemplates";

const ctx = (over: Partial<EmailContext> = {}): EmailContext => ({
  title: "MGMT 4500, Spring 2027",
  link: "https://teams.example.edu/s/abc123",
  workbookUrl: "https://teams.example.edu/peer-eval-team-factor.xlsx",
  factorFloor: 0.7,
  factorCeiling: 1.05,
  includeBehaviors: true,
  aiFeedbackEnabled: true,
  contractSections: ["Communications", "Attendance", "Integrity"],
  ...over,
});

/** Placeholders the survey template already uses, so one mail merge covers all. */
const PLACEHOLDERS = ["<STUDENT NAME>", "<LOGIN CODE>", "<DEADLINE>"];

describe("contractEmail", () => {
  it("carries the mail-merge placeholders, the link, and the deadline", () => {
    const body = contractEmail(ctx());
    for (const p of PLACEHOLDERS) expect(body).toContain(p);
    expect(body).toContain("https://teams.example.edu/s/abc123");
    expect(body).toContain("Subject: MGMT 4500, Spring 2027");
  });

  it("lists the contract sections the app will actually ask for", () => {
    const body = contractEmail(ctx());
    for (const s of ["Communications", "Attendance", "Integrity"]) expect(body).toContain(`- ${s}`);
  });

  it("tells students to share the display name they choose", () => {
    // The whole point of student-chosen names: teammates must know who is who
    // before they evaluate each other.
    expect(contractEmail(ctx())).toMatch(/tell your team which one you picked/);
  });

  it("mentions AI feedback only when it is switched on", () => {
    expect(contractEmail(ctx({ aiFeedbackEnabled: true }))).toMatch(/AI feedback/);
    expect(contractEmail(ctx({ aiFeedbackEnabled: false }))).not.toMatch(/AI feedback/);
  });
});

describe("peerEvalEmail", () => {
  it("says the practice round does not count, and the graded one does", () => {
    expect(peerEvalEmail("formative", ctx())).toMatch(/does not affect anyone's grade/);
    expect(peerEvalEmail("summative", ctx())).toMatch(/This round counts/);
  });

  it("states the neutral answer plainly in both rounds", () => {
    for (const round of ["formative", "summative"] as const) {
      const body = peerEvalEmail(round, ctx());
      expect(body).toContain("Split 100 points across your teammates");
      expect(body).toMatch(/An equal split is the default and a perfectly good answer/);
      for (const p of PLACEHOLDERS) expect(body).toContain(p);
    }
  });

  it("explains the factor only where it matters, using this session's caps", () => {
    const graded = peerEvalEmail("summative", ctx());
    expect(graded).toContain("cannot fall below 0.70 or rise above 1.05");
    expect(graded).toMatch(/highest and the lowest rating you receive are both thrown away/);
    expect(graded).toMatch(/counted as having split evenly/);
    expect(graded).toContain("https://teams.example.edu/peer-eval-team-factor.xlsx");

    // The practice round has no factor to explain — it promises feedback instead.
    const practice = peerEvalEmail("formative", ctx());
    expect(practice).not.toContain("cannot fall below");
    expect(practice).toMatch(/own result back privately/);
  });

  it("follows the instructor's own caps rather than the defaults", () => {
    const body = peerEvalEmail("summative", ctx({ factorFloor: 0.5, factorCeiling: 1.2 }));
    expect(body).toContain("cannot fall below 0.50 or rise above 1.20");
  });

  it("mentions behaviour ratings only when that part is enabled", () => {
    expect(peerEvalEmail("summative", ctx({ includeBehaviors: true }))).toMatch(/Rate each teammate 1-5/);
    expect(peerEvalEmail("summative", ctx({ includeBehaviors: false }))).not.toMatch(/Rate each teammate/);
  });

  it("promises anonymity toward teammates, not toward the instructor", () => {
    const body = peerEvalEmail("summative", ctx());
    expect(body).toMatch(/Your teammates never see what you wrote/);
    expect(body).toMatch(/Only I can read them/);
  });

  it("warns against collusion, which the arithmetic alone cannot prevent", () => {
    // Four members can still transfer value away from a fifth; the deterrent is
    // that it is visible and it is misconduct.
    expect(peerEvalEmail("summative", ctx())).toMatch(/agreeing with each other beforehand/);
  });
});

describe("emailContext", () => {
  it("derives the workbook URL from the student link's origin", () => {
    const c = emailContext(
      "Course",
      "https://teams.example.edu/s/abc123",
      { factorFloor: 0.7, factorCeiling: 1.05, includeBehaviors: false, aiFeedbackEnabled: false },
      ["Communications"],
    );
    expect(c.workbookUrl).toBe("https://teams.example.edu/peer-eval-team-factor.xlsx");
    expect(c.contractSections).toEqual(["Communications"]);
  });
});
