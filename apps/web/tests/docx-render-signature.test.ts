import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import ImageModule from "docxtemplater-image-module-free";
import { UnsignableDocxError, renderOperatDocx, signOperatDocx } from "../src/adapters/docx-render";
import { buildDocumentModel } from "../src/domain/document-model";
import { PROSE_SECTIONS } from "../src/domain/prose-snapshot";
import { goldenInputs, syntheticDocumentInput } from "./fixtures/document-model-fixture";
import { JPG_1PX, PNG_1PX } from "./fixtures/jpeg-fixtures";
import { confirmedProse } from "./fixtures/valuation-inputs";

const SIGNATURE = fs.readFileSync(path.join(__dirname, "fixtures", "signature-synthetic.png"));
const TEMPLATE_X = fs.readFileSync(path.join(process.cwd(), "templates", "operat-szablon.docx"));

/**
 * Template Y = template X with one static sentence changed — the smallest
 * stand-in for "a deploy changed the template between approve and sign"
 * (HANDOFF approval-reopen: no new binary is committed).
 */
const TEMPLATE_Y = (() => {
  const zip = new PizZip(TEMPLATE_X);
  const xml = zip.file("word/document.xml")!.asText();
  const label = "Imię i nazwisko rzeczoznawcy majątkowego:";
  expect(xml.split(label)).toHaveLength(2);
  zip.file("word/document.xml", xml.replace(label, "Imię i nazwisko (szablon po aktualizacji):"));
  return zip.generate({ type: "nodebuffer" }) as Buffer;
})();

const zipOf = (buf: Buffer) => new PizZip(buf);
const mediaOf = (buf: Buffer) =>
  Object.keys(zipOf(buf).files).filter((f) => f.startsWith("word/media/"));

const textOf = (buf: Buffer) =>
  zipOf(buf)
    .file("word/document.xml")!
    .asText()
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, " ")
    .trim();

/** Prose the appraiser may type — braces are the characters a template engine reads as tags. */
const BRACES = "Uwaga {tag}; klamra { otwarta { dwa razy; } zamknięta osobno; {%podpis}.";

const proseWith = (text: string) => {
  const prose = confirmedProse();
  const section = PROSE_SECTIONS[0];
  prose.sections[section] = { ...prose.sections[section]!, value: text };
  return prose;
};

const modelWithProse = (text: string) =>
  buildDocumentModel({
    ...syntheticDocumentInput(),
    inputs: { ...goldenInputs(), prose: proseWith(text) },
  });

/** What docxtemplater would do if signing were a second template pass over the rendered operat. */
const secondTemplatePass = (docx: Buffer) => {
  const doc = new Docxtemplater(new PizZip(docx), {
    modules: [
      new ImageModule({ centered: false, getImage: () => SIGNATURE, getSize: () => [170, 57] }),
    ],
  });
  doc.render({ podpis: "x" });
  return doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
};

describe("I-21 — the signed operat is the approved DOCX with a signature (ADR-020 wariant a)", () => {
  const model = modelWithProse(BRACES);

  it("template changed between approve and sign: the signed text is the APPROVED text, not a re-render", () => {
    const approved = renderOperatDocx(model, { template: TEMPLATE_X });
    const reRenderedAfterUpdate = renderOperatDocx(model, { template: TEMPLATE_Y });
    // Not a vacuous pass: the update really changes what a re-render prints.
    expect(textOf(reRenderedAfterUpdate)).not.toBe(textOf(approved));

    const signed = signOperatDocx(approved, SIGNATURE);

    expect(textOf(signed)).toBe(textOf(approved));
    expect(textOf(signed)).toContain("Imię i nazwisko rzeczoznawcy majątkowego:");
  });

  it("adds exactly one medium — the scan — and keeps every approved medium byte-identical", () => {
    const approved = renderOperatDocx(model, {
      maps: { ewidencyjna: PNG_1PX, orto: JPG_1PX },
      photos: { otoczenie: [JPG_1PX], budynekZewn: [], wnetrza: [] },
    });
    const signed = signOperatDocx(approved, SIGNATURE);

    const added = mediaOf(signed).filter((m) => !mediaOf(approved).includes(m));
    expect(added).toHaveLength(1);
    expect(Buffer.from(zipOf(signed).file(added[0])!.asUint8Array()).equals(SIGNATURE)).toBe(true);
    for (const m of mediaOf(approved)) {
      const before = Buffer.from(zipOf(approved).file(m)!.asUint8Array());
      expect(Buffer.from(zipOf(signed).file(m)!.asUint8Array()).equals(before)).toBe(true);
    }
    // The drawing points at the scan through a relationship that exists.
    const rels = zipOf(signed).file("word/_rels/document.xml.rels")!.asText();
    const rId = rels.match(
      new RegExp(`Id="(rId\\d+)"[^>]*Target="${added[0].replace("word/", "")}"`),
    );
    expect(rId).not.toBeNull();
    expect(zipOf(signed).file("word/document.xml")!.asText()).toContain(`r:embed="${rId![1]}"`);
    expect(rels.match(new RegExp(`Id="${rId![1]}"`, "g"))).toHaveLength(1);
  });

  it("a JPEG scan is stored as .jpeg with a registered content type", () => {
    const signed = signOperatDocx(renderOperatDocx(model), JPG_1PX);
    const added = mediaOf(signed).find((m) => m.includes("podpis"));
    expect(added).toMatch(/\.jpeg$/);
    expect(zipOf(signed).file("[Content_Types].xml")!.asText()).toContain('Extension="jpeg"');
  });

  it("the approved document shows no marker — neither tag text nor a visible placeholder", () => {
    const approved = renderOperatDocx(model);
    const text = textOf(approved);
    // The prose itself spells "{%podpis}" (BRACES); everything else must not.
    expect(text.replace(BRACES, "")).not.toContain("podpis}");
    expect(mediaOf(approved).filter((m) => m.includes("podpis"))).toEqual([]);
  });

  it("refuses a DOCX without the marker — approved before this update, or already signed", () => {
    const signedOnce = signOperatDocx(renderOperatDocx(model), SIGNATURE);
    expect(() => signOperatDocx(signedOnce, SIGNATURE)).toThrow(UnsignableDocxError);
  });

  describe("ADR-020 cz. 2 — warunki wariantu (a)", () => {
    // Warunek 1: czy moduł obrazów docxtemplater przyjmie drugi przebieg na
    // WYRENDEROWANYM DOCX. Odpowiedź z tego testu: nie w bezpiecznej postaci —
    // drugi przebieg czyta całą treść operatu jako szablon, a proza z klamrą
    // go wywraca. Dlatego podpis NIE jest drugim przebiegiem docxtemplatera:
    // `signOperatDocx` podmienia wyłącznie znacznik (HANDOFF: „podmiana
    // znacznika bez docxtemplatera”), co odpowiada twierdząco na pytanie
    // wariantu (a) — podpis wypełnia tylko znacznik na zapisanym DOCX.
    it("warunek 1: docxtemplater's second pass over a rendered operat breaks on the appraiser's braces", () => {
      // A lone brace: the second pass refuses the whole document.
      expect(() =>
        secondTemplatePass(renderOperatDocx(modelWithProse("Klamra { bez pary."))),
      ).toThrow();
      // A balanced one is worse: it is read as a tag and silently dropped from the text.
      const balanced = renderOperatDocx(modelWithProse("Uwaga {tag} w treści."));
      expect(textOf(balanced)).toContain("Uwaga {tag} w treści.");
      expect(textOf(secondTemplatePass(balanced))).not.toContain("Uwaga {tag} w treści.");
    });

    it("warunek 2: braces in the appraiser's text survive signing verbatim and are never read as tags", () => {
      const signed = signOperatDocx(renderOperatDocx(model), SIGNATURE);
      expect(textOf(signed)).toContain(BRACES);
      expect(mediaOf(signed).filter((m) => m.includes("podpis"))).toHaveLength(1);
    });

    // Warunek 3 = pierwszy test tego bloku (szablon X → Y → podpis); tu ten
    // sam przepływ dla operatu bez prozy, czyli bez przypadkowej zgodności
    // przez sekcje opisowe.
    it("warunek 3: the drift guard covers render X → template Y → sign for an operat without prose", () => {
      const plainModel = buildDocumentModel(syntheticDocumentInput());
      const approved = renderOperatDocx(plainModel, { template: TEMPLATE_X });
      expect(textOf(renderOperatDocx(plainModel, { template: TEMPLATE_Y }))).not.toBe(
        textOf(approved),
      );
      expect(textOf(signOperatDocx(approved, SIGNATURE))).toBe(textOf(approved));
    });
  });
});
