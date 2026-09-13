// Run from apps/web with pnpm exec tsx ../../tools/spike/2026-09-13-legacy-render/capture.mts.
// Capture only on untouched baseline9b2903c render code, before S4 template edits.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { syntheticDocumentInput } from "../../../apps/web/tests/fixtures/document-model-fixture";
import { confirmedProse } from "../../../apps/web/tests/fixtures/valuation-inputs";
import { computeKcs } from "../../../apps/web/src/domain/kcs";
import { buildDocumentModel } from "../../../apps/web/src/domain/document-model";
import { renderOperatDocx } from "../../../apps/web/src/adapters/docx-render";
const requireApp = createRequire(path.resolve("package.json"));
const PizZip = requireApp("pizzip");
const out = "/tmp/pairwise-legacy-render";
fs.mkdirSync(out, { recursive: true });
const records = [];
const sha = (buf: string | Buffer) => createHash("sha256").update(buf).digest("hex");
for (const propertyRight of ["wlasnosc_lokalu", "spoldzielcze_wlasnosciowe"] as const) {
  const input = syntheticDocumentInput();
  input.propertyRight = propertyRight;
  input.inputs.features = input.inputs.features.map((f, i) => ({
    ...f,
    weight: [0.4025, 0.3, 0.2975][i],
  }));
  input.inputs.prose = confirmedProse();
  input.kcs = computeKcs(input.inputs);
  input.amountInWords = `wynik syntetyczny ${input.kcs.wr} złotych`;
  const buffer = renderOperatDocx(buildDocumentModel(input));
  const text = new PizZip(buffer)
    .file("word/document.xml")
    .asText()
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, " ")
    .trim();
  fs.writeFileSync(path.join(out, propertyRight + ".docx"), buffer);
  fs.writeFileSync(path.join(out, propertyRight + ".txt"), text);
  records.push({ propertyRight, input, textSha256: sha(text) });
}
fs.writeFileSync(
  path.join(out, "baseline.json"),
  JSON.stringify(
    {
      sourceCommit: "9b2903c",
      templateSha256: sha(fs.readFileSync("templates/operat-szablon.docx")),
      textExtraction: "replace XML tags with |, collapse |+ to space, trim; no other normalization",
      records,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Captured synthetic legacy render for both rights with fractional weights and prose at " + out,
);
