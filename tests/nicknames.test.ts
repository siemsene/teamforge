import { describe, expect, it } from "vitest";
import { NICKNAME_MAX_LENGTH } from "../src/types";
import { displayName, hasNickname, sanitizeNickname, validateNickname } from "../src/lib/nicknames";

describe("sanitizeNickname", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeNickname("  Ana   Ng  ")).toBe("Ana Ng");
  });

  it("strips control characters so a name cannot break a table or CSV", () => {
    expect(sanitizeNickname("Ana\nNg")).toBe("Ana Ng");
    expect(sanitizeNickname("Ana\tNg")).toBe("Ana Ng");
    expect(sanitizeNickname(`Ana${String.fromCharCode(0x00)}Ng`)).toBe("Ana Ng"); // NUL
    expect(sanitizeNickname(`Ana${String.fromCharCode(0x7f)}Ng`)).toBe("Ana Ng"); // DEL
  });

  it("caps the length", () => {
    expect(sanitizeNickname("x".repeat(200))).toHaveLength(NICKNAME_MAX_LENGTH);
  });

  it("keeps ordinary names and accents intact", () => {
    expect(sanitizeNickname("José M.")).toBe("José M.");
    expect(sanitizeNickname("小明")).toBe("小明");
  });
});

describe("validateNickname", () => {
  it("accepts a normal name", () => {
    expect(validateNickname("Ana Ng", [])).toEqual([]);
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(validateNickname("", [])).toHaveLength(1);
    expect(validateNickname("   ", [])).toHaveLength(1);
  });

  it("rejects a name longer than the cap", () => {
    expect(validateNickname("x".repeat(NICKNAME_MAX_LENGTH + 1), []).join(" ")).toMatch(/characters or fewer/);
  });

  it("rejects a duplicate within the team, case-insensitively", () => {
    expect(validateNickname("ana ng", ["Ana Ng"]).join(" ")).toMatch(/already using that name/);
  });

  it("allows a name a different team happens to use (only teammates are passed in)", () => {
    expect(validateNickname("Ana Ng", ["Ben Ho"])).toEqual([]);
  });
});

describe("displayName", () => {
  it("falls back to the code index when no nickname is set", () => {
    expect(displayName(3, {})).toBe("#3");
    expect(displayName(3, { "3": "Ana" })).toBe("Ana");
  });

  it("treats an empty string as unset", () => {
    expect(displayName(3, { "3": "" })).toBe("#3");
    expect(hasNickname(3, { "3": "" })).toBe(false);
    expect(hasNickname(3, { "3": "Ana" })).toBe(true);
  });
});
