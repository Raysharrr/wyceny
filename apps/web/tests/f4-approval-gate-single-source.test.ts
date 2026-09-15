/**
 * R-1 (operat-bugfix, paczka 1) — architecture guard for F-4.
 *
 * The approval gate used to be composed by hand in four places, kept in step
 * only by "Mirrors …" comments. Paczka 1 adds nine blockers; a blocker added
 * to three of the four would show an enabled button the action then refuses,
 * or refuse on the screen what the transaction would let through. This test
 * reads the sources and pins that nothing under `src/` except
 * `domain/valuation.ts` calls `approvalGate` / `documentFieldBlockers`, and
 * that the known call sites go through `approvalBlockers`. The order and
 * shapes of the list are pinned in `f4-approval-gate.test.ts` ("R-1:
 * approvalBlockers — pin …").
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

const src = (path: string) => readFileSync(join(SRC_DIR, path), "utf8");

/** Every `.ts`/`.tsx` file under `src/`, as a path relative to it. */
function sourceFiles(dir = SRC_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [relative(SRC_DIR, full)] : [];
  });
}

/** The body of a top-level `export function name(...) { ... }`, up to its closing brace. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  expect(start, `export function ${name} not found`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n}\n", start);
  expect(end, `end of ${name} not found`).toBeGreaterThan(start);
  return source.slice(start, end);
}

/** Call sites of `fn` — its own `function fn(` definition does not count. */
const calls = (source: string, fn: string) =>
  (source.match(new RegExp(`\\b${fn}\\(`, "g"))?.length ?? 0) -
  (source.match(new RegExp(`\\bfunction\\s+${fn}\\(`, "g"))?.length ?? 0);

const CALL_SITES = [
  "app/valuations/[id]/page.tsx",
  "app/valuations/[id]/steps/step-operat.tsx",
  "app/actions/approve-valuation.ts",
] as const;

describe("F-4 single source: approvalBlockers is the only gate composition (R-1)", () => {
  it.each(CALL_SITES)("%s imports and calls approvalBlockers", (path) => {
    const source = src(path);
    expect(source).toMatch(
      /import\s*\{[^}]*\bapprovalBlockers\b[^}]*\}\s*from\s*"@\/domain\/valuation"/,
    );
    expect(calls(source, "approvalBlockers")).toBeGreaterThan(0);
  });

  it.each(["approvalGate", "documentFieldBlockers"])(
    "%s is called nowhere in src/ but domain/valuation.ts",
    (fn) => {
      const files = sourceFiles();
      // Sanity: the walk really reached the tree, including the known call sites.
      expect(files).toEqual(expect.arrayContaining([...CALL_SITES, "domain/valuation.ts"]));
      const callers = files.filter((path) => calls(src(path), fn) > 0);
      expect(callers).toEqual(["domain/valuation.ts"]);
    },
  );

  it("domain approveValuation goes through approvalBlockers, not the parts", () => {
    const body = functionBody(src("domain/valuation.ts"), "approveValuation");
    expect(calls(body, "approvalBlockers")).toBe(1);
    expect(calls(body, "approvalGate")).toBe(0);
    expect(calls(body, "documentFieldBlockers")).toBe(0);
  });

  it("domain/valuation.ts calls the parts exactly once — inside approvalBlockers", () => {
    const source = src("domain/valuation.ts");
    const body = functionBody(source, "approvalBlockers");
    expect(calls(source, "approvalGate")).toBe(1);
    expect(calls(source, "documentFieldBlockers")).toBe(1);
    expect(calls(body, "approvalGate")).toBe(1);
    expect(calls(body, "documentFieldBlockers")).toBe(1);
  });

  it("the gate context (kill switch + section hashes) is computed in one app-layer helper", () => {
    for (const path of CALL_SITES) {
      const source = src(path);
      expect(source, path).toMatch(/\bgateContextFor\(/);
      expect(calls(source, "currentSectionFactsHashes"), path).toBe(0);
    }
  });
});
