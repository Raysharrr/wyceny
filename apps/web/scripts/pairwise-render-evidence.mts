import { httpWorker } from "../src/adapters/worker-http";
import { FEATURE_PRESETS } from "../src/domain/feature-presets";
/** Local synthetic S4 evidence. Uses the running isolated real worker; no LLM. */
import fs from "node:fs";
import {
  buildDocumentModel,
  prepareOperatModel,
  type BuildDocumentInput,
} from "../src/domain/document-model";
import { computeValuation } from "../src/domain/valuation-calculation";
import { renderOperatDocx } from "../src/adapters/docx-render";
import { pairwiseReference } from "../tests/fixtures/pairwise-document-fixture";
import { syntheticDocumentInput } from "../tests/fixtures/document-model-fixture";
import { confirmedProse } from "../tests/fixtures/valuation-inputs";
const worker = httpWorker("http://127.0.0.1:8019");
const out = "/tmp/pairwise-s4-render";
fs.mkdirSync(out, { recursive: true });
const records: { name: string; bytes: number }[] = [];
const signature = fs.readFileSync("tests/fixtures/signature-synthetic.png");
async function save(name: string, docx: Buffer) {
  fs.writeFileSync(`${out}/${name}.docx`, docx);
  const response = await fetch("http://127.0.0.1:8019/convert-to-pdf", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array(docx),
  });
  if (!response.ok) throw Error(await response.text());
  const pdf = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(`${out}/${name}.pdf`, pdf);
  records.push({ name, bytes: pdf.length });
  console.log(name, pdf.length);
}
for (const propertyRight of ["wlasnosc_lokalu", "spoldzielcze_wlasnosciowe"] as const) {
  for (const count of [3, 4, 5]) {
    const inputs = pairwiseReference("a");
    for (let i = 3; i < count; i++) {
      const id = `manual:extra-${i}`;
      inputs.comparables.push({ ...inputs.comparables[i - 3], id: `extra-${i}` });
      inputs.pairwise!.selectedComparableIds.push(id);
      inputs.pairwise!.comparisons[id] = structuredClone(
        inputs.pairwise!.comparisons[inputs.pairwise!.selectedComparableIds[i - 3]],
      );
    }
    if (count === 5) {
      const f = inputs.features[3];
      const old = f.key!;
      f.key = "inne";
      f.name =
        "Dodatkowa cecha — nasłonecznienie i funkcjonalność przestrzeni wspólnej, zieleń oraz dostępność udogodnień";
      f.ratingScale = "two";
      f.rating = "lepsza";
      f.definitions = {
        lepsza: "Dostępne udogodnienia, zieleń i dobre nasłonecznienie.",
        gorsza: "Ograniczone udogodnienia i nasłonecznienie.",
      };
      for (const cells of Object.values(inputs.pairwise!.comparisons)) {
        cells.inne = {
          ...cells[old],
          rating: "gorsza",
          multiplier: -0.25,
          overrideReason: "Przyjęto ćwierć zakresu ze względu na częściową użyteczność udogodnień.",
        };
        delete cells[old];
      }
      for (const preset of FEATURE_PRESETS.lokal) {
        if (inputs.features.some((f) => f.key === preset.key)) continue;
        inputs.features.push({
          key: preset.key,
          name: preset.name,
          weight: 0.1,
          rating: "przecietna",
          definitions: preset.defaultDefinitions,
        });
        for (const cells of Object.values(inputs.pairwise!.comparisons))
          cells[preset.key] = { rating: "przecietna", multiplier: 0 };
      }
      inputs.features.forEach((f) => (f.weight = 0.1));
      inputs.features[0].weight = 0.1025;
      inputs.features[1].weight = 0.0975;
    }
    inputs.prose = confirmedProse();
    const result = computeValuation(inputs);
    const model = buildDocumentModel({
      ...syntheticDocumentInput(),
      propertyRight,
      area: inputs.area,
      inputs,
      result,
      amountInWords: await worker.amountInWords(result.wr),
    });
    await save(
      `pp-${count}-${propertyRight}`,
      renderOperatDocx(model, {
        signature,
        ...(count === 5 && fs.existsSync(`${out}/map-synthetic.jpg`)
          ? {
              maps: {
                ewidencyjna: fs.readFileSync(`${out}/map-synthetic.jpg`),
                orto: fs.readFileSync(`${out}/map-synthetic.jpg`),
              },
              photos: {
                otoczenie: [fs.readFileSync(`${out}/photo-synthetic.jpg`)],
                budynekZewn: [fs.readFileSync(`${out}/photo-synthetic.jpg`)],
                wnetrza: [fs.readFileSync(`${out}/photo-synthetic.jpg`)],
              },
            }
          : {}),
      }),
    );
  }
  const input = syntheticDocumentInput();
  input.propertyRight = propertyRight;
  input.inputs.method = "kcs";
  input.inputs.features[0].weight = 0.4025;
  input.inputs.features[2].weight = 0.2975;
  input.inputs.features[1].ratingScale = "two";
  input.inputs.features[1].definitions = { lepsza: "Górne kondygnacje.", gorsza: "Parter." };
  input.inputs.features[2] = {
    ...input.inputs.features[2],
    key: "inne",
    name: "Własna cecha — dostępność zieleni i przestrzeni wspólnej",
    definitions: {
      lepsza: "Pełna dostępność.",
      przecietna: "Częściowa dostępność.",
      gorsza: "Brak dostępności.",
    },
  };
  input.result = computeValuation(input.inputs);
  input.amountInWords = await worker.amountInWords(input.result.wr);
  input.inputs.prose = confirmedProse();
  await save(
    `kcs-current-${propertyRight}`,
    renderOperatDocx(buildDocumentModel(input), { signature }),
  );
  const baseline = JSON.parse(
    fs.readFileSync("../../tools/spike/2026-09-13-legacy-render/baseline.json", "utf8"),
  );
  const frozen = baseline.records.find(
    (r: { propertyRight: string }) => r.propertyRight === propertyRight,
  ).input;
  const prepared = prepareOperatModel(
    { ...frozen, approvedAt: new Date(frozen.approvedAt) } as BuildDocumentInput,
    { signing: true },
  );
  await save(
    `kcs-legacy-${propertyRight}`,
    renderOperatDocx(prepared.model, { signature, templateVersion: prepared.templateVersion }),
  );
}
fs.writeFileSync(`${out}/results.json`, JSON.stringify(records, null, 2));
