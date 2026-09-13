import fs from "node:fs";
import path from "node:path";
import { it, expect } from "vitest";
/** AC12: integrated wizard, operation and prose entry points share the dispatcher. */
it("wizard, server operations and prose route all arithmetic through computeValuation", () => {
  const dirs = ["src/app/actions", "src/app/valuations", "src/domain"];
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
    .filter((f) => /\.tsx?$/.test(f) && !allowed.has(f))
    .filter((f) =>
      /\bcomputeKcs\s*\(/.test(
        fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""),
      ),
    );
  expect(offenders).toEqual([]);
});
