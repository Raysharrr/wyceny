import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import { renderOperatDocx } from "../src/adapters/docx-render";
import { buildDocumentModel } from "../src/domain/document-model";
import { syntheticDocumentInput } from "./fixtures/document-model-fixture";

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
});
