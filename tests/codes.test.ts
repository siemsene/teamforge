import { describe, expect, it } from "vitest";
import { generateCodes, hashCode, normalizeCode } from "../src/lib/codes";

describe("login codes", () => {
  it("generates the requested number of unique codes", () => {
    const codes = generateCodes(500);
    expect(new Set(codes).size).toBe(500);
    for (const c of codes) expect(c).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
  });

  it("normalization forgives case, dashes, spaces and lookalike characters", () => {
    expect(normalizeCode(" abc12-de345 ")).toBe("ABC12DE345");
    expect(normalizeCode("ABCl2-DE345")).toBe("ABC12DE345"); // l -> 1
    expect(normalizeCode("ABC12-DE34O")).toBe("ABC12DE340"); // O -> 0
  });

  it("hashing is stable across formatting differences", async () => {
    expect(await hashCode("abc12-de345")).toBe(await hashCode("ABC12DE345"));
    expect(await hashCode("AAAAA-AAAAA")).not.toBe(await hashCode("AAAAA-AAAAB"));
  });
});
