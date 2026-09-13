import { createHash } from "node:crypto";
import fs from "node:fs";
import { describe, it, expect } from "vitest";
import PizZip from "pizzip";
import { buildDocumentModel, type BuildDocumentInput } from "../src/domain/document-model";
import { buildLegacyDocumentModel } from "../src/domain/legacy-kcs-document";
import { computePairwise } from "../src/domain/pairwise";
import { renderOperatDocx } from "../src/adapters/docx-render";
import { syntheticDocumentInput } from "./fixtures/document-model-fixture";
import { pairwiseReference } from "./fixtures/pairwise-document-fixture";
const xmlOf = (buffer: Buffer) => new PizZip(buffer).file("word/document.xml")!.asText();
const textOf = (xml: string) =>
  xml
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, " ")
    .trim();
const baseline: {
  templateSha256: string;
  records: {
    input: Omit<BuildDocumentInput, "approvedAt"> & {
      approvedAt: string;
      kcs: NonNullable<BuildDocumentInput["kcs"]>;
    };
    textSha256: string;
  }[];
} = JSON.parse(fs.readFileSync("../../tools/spike/2026-09-13-legacy-render/baseline.json", "utf8"));

describe("S4 actual document contract", () => {
  it("pins the exact preserved legacy template bytes", () => {
    expect(
      createHash("sha256")
        .update(fs.readFileSync("templates/operat-szablon-legacy-kcs.docx"))
        .digest("hex"),
    ).toBe(baseline.templateSha256);
  });
  it.each(baseline.records)(
    "preserves frozen 9b text for $propertyRight",
    ({ input, textSha256 }) => {
      const model = buildLegacyDocumentModel({ ...input, approvedAt: new Date(input.approvedAt) });
      const signed = renderOperatDocx(model, {
        templateVersion: "legacy-kcs",
        signature: fs.readFileSync("tests/fixtures/signature-synthetic.png"),
      });
      expect(
        createHash("sha256")
          .update(textOf(xmlOf(signed)))
          .digest("hex"),
      ).toBe(textSha256);
    },
  );
  it.each(["wlasnosc_lokalu", "spoldzielcze_wlasnosciowe"] as const)(
    "renders four PP tables and reference value for %s",
    (propertyRight) => {
      const inputs = pairwiseReference("a");
      const result = { method: "pp" as const, ...computePairwise(inputs) };
      const model = buildDocumentModel({
        ...syntheticDocumentInput(),
        propertyRight,
        inputs,
        area: inputs.area,
        result,
      } as BuildDocumentInput);
      const xml = xmlOf(renderOperatDocx(model));
      expect(textOf(xml)).toContain("porównywania parami");
      expect(textOf(xml).replace(/\u00a0/g, " ")).toContain("740 900");
      expect(xml.match(/w:tblCaption w:val="pp-/g) ?? []).toHaveLength(4);
      expect(textOf(xml)).not.toContain("undefined");
      expect(textOf(xml)).not.toContain("korygowania ceny średniej");
    },
  );
});

describe("PP columns and modern KCS scales", () => {
  it.each([3, 4, 5])(
    "renders %i comparison columns with repeated headers and no placeholders",
    (count) => {
      const inputs = pairwiseReference("a");
      for (let i = 3; i < count; i++) {
        const id = `manual:x${i}`;
        inputs.comparables.push({ ...inputs.comparables[0], id: `x${i}` });
        inputs.pairwise!.selectedComparableIds.push(id);
        inputs.pairwise!.comparisons[id] = structuredClone(
          inputs.pairwise!.comparisons[inputs.pairwise!.selectedComparableIds[0]],
        );
      }
      const result = { method: "pp" as const, ...computePairwise(inputs) };
      const xml = xmlOf(
        renderOperatDocx(buildDocumentModel({ ...syntheticDocumentInput(), inputs, result })),
      );
      const tables = (xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? []).filter((t) =>
        t.includes('w:val="pp-dynamic-'),
      );
      expect(tables).toHaveLength(3);
      for (const [i, table] of tables.entries()) {
        const fixed = [2, 3, 1][i];
        expect(table.match(/<w:gridCol\b/g) ?? []).toHaveLength(fixed + count);
        expect(table).toContain("<w:tblHeader/>");
        for (const row of table.match(/<w:tr[\s\S]*?<\/w:tr>/g) ?? [])
          expect(row.match(/<w:tc>/g) ?? []).toHaveLength(fixed + count);
      }
      expect(textOf(xml)).not.toMatch(/undefined|\{[^}]*\}/);
      expect(textOf(tables[0])).toContain("standard wykończenia");
      expect(textOf(tables[1])).toContain("SUMA");
    },
  );
  it("prints fractional weights, actual totals and a dash for two-level middle values", () => {
    const input = syntheticDocumentInput();
    input.inputs.features[0].weight = 0.4025;
    input.inputs.features[2].weight = 0.2975;
    input.inputs.features[1].ratingScale = "two";
    input.inputs.features[1].definitions = {
      lepsza: "Dobra",
      gorsza: "Słaba",
      przecietna: "STALE MIDDLE",
    };
    const model = buildDocumentModel({
      ...input,
      result: {
        method: "kcs",
        ...input.kcs!,
        ui: input.inputs.features.map((f, i) => ({ ...f, value: input.kcs!.ui[i].value })),
      },
    });
    expect(model.cechy[0].waga_pct).toBe("40,25");
    expect(model.cechy[1].ui_sr).toBe("—");
    expect(model.suma_ui_sr).toBe("—");
    expect(model.suma_wag).toBe("100");
    const text = textOf(xmlOf(renderOperatDocx(model)));
    expect(text).toContain("40,25");
    expect(text).toContain("brak oceny pośredniej");
    expect(text).not.toContain("STALE MIDDLE");
    expect(text).not.toContain("Tabela 3. Obliczenie skorygowanej");
    expect(text).not.toContain("porównywania parami");
  });
});
