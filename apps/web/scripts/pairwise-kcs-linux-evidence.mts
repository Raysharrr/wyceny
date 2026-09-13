/** Synthetic DOCX inputs for real Linux LibreOffice KCS layout verification. */
import fs from "node:fs";
import path from "node:path";
import { renderOperatDocx } from "../src/adapters/docx-render";
import { buildDocumentModel } from "../src/domain/document-model";
import { computeValuation } from "../src/domain/valuation-calculation";
import { syntheticDocumentInput } from "../tests/fixtures/document-model-fixture";
import { confirmedProse } from "../tests/fixtures/valuation-inputs";
const out = process.argv[2];
if (!out) throw Error("Usage: tsx scripts/pairwise-kcs-linux-evidence.mts OUTPUT_DIRECTORY");
fs.mkdirSync(out, { recursive: true });
for (const propertyRight of ["wlasnosc_lokalu", "spoldzielcze_wlasnosciowe"] as const) {
  for (const [name, weights] of Object.entries({
    fractional: [0.4025, 0.5975],
    nearMaximum: [0.9999, 0.0001],
    maximum: [1, 0],
  })) {
    const input = syntheticDocumentInput();
    input.propertyRight = propertyRight;
    input.inputs.method = "kcs";
    input.inputs.features = input.inputs.features.slice(0, 2);
    input.inputs.features.forEach((feature, i) => {
      feature.weight = weights[i];
    });
    input.inputs.features[1] = {
      ...input.inputs.features[1],
      key: "inne",
      name: "Nasłonecznienie łazienki",
      ratingScale: "two",
      rating: "lepsza",
      definitions: { lepsza: "Dobre", gorsza: "Słabe" },
    };
    input.inputs.prose = confirmedProse();
    input.result = computeValuation(input.inputs);
    // Layout-only fixture: no network or worker amount-in-words dependency.
    input.amountInWords = "syntetyczna kwota do kontroli układu";
    fs.writeFileSync(
      path.join(out, `${name}-${propertyRight}.docx`),
      renderOperatDocx(buildDocumentModel(input)),
    );
  }
}
