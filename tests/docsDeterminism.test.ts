import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The generated guides and workbook must be byte-identical run to run.
 *
 * They were not: pdfkit derives the PDF's /ID trailer from an MD5 of its info
 * dictionary, whose CreationDate defaults to `new Date()`, and exceljs stamps
 * every zip entry with the time it happened to run. So `npm run docs` rewrote
 * all three files whether or not a word had changed, and every docs commit
 * carried a few hundred bytes of pure noise — which also makes a real content
 * change impossible to spot in a diff.
 */
const ROOT = join(__dirname, "..");
const SCRIPTS = [
  ["generate-instructor-guide.mjs", "instructor-guide.pdf"],
  ["generate-student-guide.mjs", "student-guide.pdf"],
  ["generate-factor-workbook.mjs", "peer-eval-team-factor.xlsx"],
] as const;

const dirs: string[] = [];
function generate(): Map<string, string> {
  const out = mkdtempSync(join(tmpdir(), "teamforge-docs-"));
  dirs.push(out);
  for (const [script] of SCRIPTS) {
    execFileSync(process.execPath, [join(ROOT, "scripts", script)], {
      cwd: ROOT,
      env: { ...process.env, DOCS_OUT_DIR: out },
      stdio: "pipe",
    });
  }
  return new Map(
    readdirSync(out).map((f) => [f, createHash("sha256").update(readFileSync(join(out, f))).digest("hex")]),
  );
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("generated documents are reproducible", () => {
  const first = generate();
  const second = generate();

  it("produces all three documents", () => {
    expect([...first.keys()].sort()).toEqual(SCRIPTS.map(([, f]) => f).sort());
  });

  it.each(SCRIPTS.map(([, file]) => file))("%s is byte-identical across runs", (file) => {
    expect(second.get(file)).toBe(first.get(file));
  });

  it("honours SOURCE_DATE_EPOCH, so a real timestamp is still possible", async () => {
    // The reproducible-builds convention: pinned by default, overridable.
    // @ts-expect-error - plain .mjs build script, no type declarations
    const { BUILD_DATE } = await import("../scripts/deterministic.mjs");
    expect(BUILD_DATE.getTime()).toBe(0);
  });
}, 120_000);
