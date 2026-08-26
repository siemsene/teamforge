import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the deployed Content-Security-Policy.
 *
 * The team optimizer is highs-js, a WebAssembly MIP solver running in a Web
 * Worker. CSP treats compiling WebAssembly as a form of code generation, so
 * `script-src 'self'` alone blocks it — the solver failed at
 * `WebAssembly.instantiate` with "'unsafe-eval' is not an allowed source of
 * script", and allocation could not run at all on the deployed site.
 *
 * `'wasm-unsafe-eval'` is the narrow keyword that permits WebAssembly and
 * nothing else. Verified in headless Chrome against this exact policy string:
 * the real 3MB solver binary compiles, while eval() and new Function() still
 * throw EvalError. Reaching for `'unsafe-eval'` would also have fixed the
 * solver, but it re-enables JavaScript code generation across the whole app —
 * which is why the assertion below rejects it.
 */
const CSP: string = (() => {
  const cfg = JSON.parse(readFileSync(join(__dirname, "..", "firebase.json"), "utf8"));
  const header = cfg.hosting.headers
    .flatMap((h: { headers: { key: string; value: string }[] }) => h.headers)
    .find((h: { key: string }) => h.key === "Content-Security-Policy");
  return header.value;
})();

function directive(name: string): string[] {
  const found = CSP.split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
  return found ? found.split(/\s+/).slice(1) : [];
}

describe("deployed Content-Security-Policy", () => {
  it("allows WebAssembly, so the team optimizer can run", () => {
    expect(directive("script-src")).toContain("'wasm-unsafe-eval'");
  });

  it("does not reach for 'unsafe-eval' to get there", () => {
    // The lazy fix for the same symptom. It would re-enable eval() and
    // new Function() everywhere, which this app has no need for.
    expect(CSP).not.toContain("'unsafe-eval'");
    expect(directive("script-src")).not.toContain("'unsafe-eval'");
  });

  it("still loads scripts only from our own origin", () => {
    const scriptSrc = directive("script-src");
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc.filter((s) => !s.startsWith("'"))).toEqual([]); // no remote hosts
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("keeps the rest of the policy locked down", () => {
    expect(directive("default-src")).toEqual(["'self'"]);
    expect(directive("object-src")).toEqual(["'none'"]);
    expect(directive("base-uri")).toEqual(["'self'"]);
    expect(directive("frame-ancestors")).toEqual(["'none'"]);
    expect(directive("form-action")).toEqual(["'self'"]);
  });

  it("still permits the origins the app actually talks to", () => {
    const connect = directive("connect-src");
    expect(connect).toContain("'self'"); // Firestore long-poll fallback, wasm, assets
    expect(connect).toContain("https://*.googleapis.com"); // Firebase
    expect(connect).toContain("https://*.workers.dev"); // AI contract-feedback proxy
  });
});
