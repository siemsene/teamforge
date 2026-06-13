import { describe, expect, it } from "vitest";
import { approvalEmailBody, approvalEmailHref, approvalEmailSubject } from "../src/lib/email";

describe("approval email draft", () => {
  it("uses plain, direct approval copy", () => {
    expect(approvalEmailSubject()).toBe("TeamForge instructor account approved");
    expect(approvalEmailBody("Dr. Example")).toContain("Your TeamForge instructor account has been approved.");
  });

  it("creates a mailto URL for the instructor", () => {
    const href = approvalEmailHref("Dr. Example", "person@example.edu");
    expect(href).toContain("mailto:person%40example.edu");
    expect(href).toContain("subject=TeamForge%20instructor%20account%20approved");
  });
});
