import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import { renderOperatDocx } from "../src/adapters/docx-render";
import { buildDocumentModel } from "../src/domain/document-model";
import { goldenInputs, syntheticDocumentInput } from "./fixtures/document-model-fixture";
import { confirmedProse } from "./fixtures/valuation-inputs";

const SIGNATURE = fs.readFileSync(path.join(__dirname, "fixtures", "signature-synthetic.png"));

const mediaOf = (buf: Buffer) =>
  Object.keys(new PizZip(buf).files).filter((f) => f.startsWith("word/media/"));

const textOf = (buf: Buffer) =>
  new PizZip(buf)
    .file("word/document.xml")!
    .asText()
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, " ")
    .trim();

describe("renderOperatDocx signature (F-7 sign path)", () => {
  const model = buildDocumentModel(syntheticDocumentInput());

  it("embeds the signature image when a scan is provided", () => {
    const plain = renderOperatDocx(model);
    const signed = renderOperatDocx(model, { signature: SIGNATURE });
    expect(mediaOf(signed).length).toBe(mediaOf(plain).length + 1);
  });

  it("renders empty (no media, no leftover tag) without a scan — approve path", () => {
    const plain = renderOperatDocx(model);
    expect(textOf(plain)).not.toContain("{%podpis}");
  });

  it("signed and approved renders have identical text (drift guard)", () => {
    const plain = renderOperatDocx(model);
    const signed = renderOperatDocx(model, { signature: SIGNATURE });
    expect(textOf(signed)).toBe(textOf(plain));
  });

  // T7 handoff #2 expected the guard above to cover the prose "for free" once
  // T8 put it in the model. It does not: `syntheticDocumentInput()` carries no
  // prose, so the assertion is silent about the six sections. This case is what
  // makes the promise real — approve↔sign equality on the PRINTED paragraphs,
  // one floor below `prose-freeze.test.ts` (which pins it at snapshot level).
  it("signed and approved renders have identical text when the operat carries prose", () => {
    const withProse = buildDocumentModel({
      ...syntheticDocumentInput(),
      inputs: { ...goldenInputs(), prose: confirmedProse() },
    });
    const plain = renderOperatDocx(withProse);
    const signed = renderOperatDocx(withProse, { signature: SIGNATURE });
    expect(textOf(signed)).toBe(textOf(plain));
    // Not a vacuous pass: the prose really is in both renders.
    expect(textOf(plain)).toContain("Tekst sekcji uzasadnienie");
  });
});
