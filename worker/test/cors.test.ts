import { describe, expect, it } from "vitest";
import { allowedOrigins, corsHeaders, isAllowedOrigin, type Env } from "../src/index";

/**
 * The worker rejected the app outright once TeamForge moved to a custom domain:
 *
 *   Access to fetch at '.../v1/feedback' from origin 'https://teamforge.edutool.org'
 *   has been blocked by CORS policy: ... header has a value
 *   'https://teamforge-b1fa9.web.app' that is not equal to the supplied origin.
 *
 * ALLOWED_ORIGIN was a single value, but one deployment answers to several
 * names and the browser sends whichever the student actually loaded.
 */
const env = (over: Partial<Env> = {}) =>
  ({
    ALLOWED_ORIGINS: "https://teamforge.edutool.org,https://teamforge-b1fa9.web.app",
    ...over,
  }) as Env;

const CUSTOM = "https://teamforge.edutool.org";
const FIREBASE = "https://teamforge-b1fa9.web.app";

describe("allowedOrigins", () => {
  it("parses a comma-separated list, tolerating whitespace", () => {
    const e = env({ ALLOWED_ORIGINS: " https://a.test , https://b.test ,, " });
    expect(allowedOrigins(e)).toEqual(["https://a.test", "https://b.test"]);
  });

  it("still honours the older singular variable", () => {
    const e = { ALLOWED_ORIGIN: FIREBASE } as Env;
    expect(allowedOrigins(e)).toEqual([FIREBASE]);
    expect(isAllowedOrigin(e, FIREBASE)).toBe(true);
  });

  it("prefers the plural form when both are set", () => {
    const e = { ALLOWED_ORIGINS: CUSTOM, ALLOWED_ORIGIN: FIREBASE } as Env;
    expect(allowedOrigins(e)).toEqual([CUSTOM]);
  });

  it("allows nothing when neither is configured", () => {
    expect(allowedOrigins({} as Env)).toEqual([]);
    expect(isAllowedOrigin({} as Env, CUSTOM)).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("accepts every configured host", () => {
    expect(isAllowedOrigin(env(), CUSTOM)).toBe(true);
    expect(isAllowedOrigin(env(), FIREBASE)).toBe(true);
  });

  it("rejects anything else, including a missing origin", () => {
    expect(isAllowedOrigin(env(), "https://evil.test")).toBe(false);
    expect(isAllowedOrigin(env(), null)).toBe(false);
    // No prefix or suffix matching — a lookalike host must not slip through.
    expect(isAllowedOrigin(env(), "https://teamforge.edutool.org.evil.test")).toBe(false);
    expect(isAllowedOrigin(env(), "http://teamforge.edutool.org")).toBe(false); // scheme matters
  });
});

describe("corsHeaders", () => {
  it("echoes the caller's own origin, since the header cannot carry a list", () => {
    expect(corsHeaders(env(), CUSTOM)["Access-Control-Allow-Origin"]).toBe(CUSTOM);
    expect(corsHeaders(env(), FIREBASE)["Access-Control-Allow-Origin"]).toBe(FIREBASE);
  });

  it("sends no allow header at all for a rejected origin", () => {
    // Must agree with the server-side check rather than contradict it.
    expect(corsHeaders(env(), "https://evil.test")).not.toHaveProperty("Access-Control-Allow-Origin");
    expect(corsHeaders(env(), null)).not.toHaveProperty("Access-Control-Allow-Origin");
  });

  it("always varies on Origin, so responses are never cached across origins", () => {
    for (const o of [CUSTOM, "https://evil.test", null]) {
      expect(corsHeaders(env(), o).Vary).toBe("Origin");
    }
  });

  it("permits only the method and header the app actually uses", () => {
    const h = corsHeaders(env(), CUSTOM);
    expect(h["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
    expect(h["Access-Control-Allow-Headers"]).toBe("content-type");
  });
});
