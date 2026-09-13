import fs from "node:fs";
import path from "node:path";
import { it, expect } from "vitest";
/** S3 owns wizard/card engines; S4 pins server operation and prose entry points. */
it("server operations and prose route all arithmetic through computeValuation", () => {
  const dirs = ["src/app/actions", "src/domain"];
  const allowed = new Set([
    "src/domain/kcs.ts",
    "src/domain/valuation-calculation.ts",
    "src/domain/legacy-kcs-document.ts",
  ]);
  const files = (dir: string): string[] =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const offenders = dirs
    .flatMap(files)
    .filter((f) => f.endsWith(".ts") && !allowed.has(f))
    .filter((f) =>
      /\bcomputeKcs\s*\(/.test(
        fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""),
      ),
    );
  expect(offenders).toEqual([]);
});
