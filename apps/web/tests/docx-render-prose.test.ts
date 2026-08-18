import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { computeKcs, type KcsInput } from "../src/domain/kcs";
import { buildDocumentModel } from "../src/domain/document-model";
import { renderOperatDocx } from "../src/adapters/docx-render";
import { PROSE_SECTIONS, type ProseSnapshot } from "../src/domain/prose-snapshot";
import { goldenInputs, syntheticDocumentInput } from "./fixtures/document-model-fixture";
import { confirmedProse } from "./fixtures/valuation-inputs";

/**
 * T8: the appraiser's confirmed prose reaches the operat.
 *
 * Two properties the template's shape rests on:
 *  1. every `inputs.prose` section prints where its stub used to be;
 *  2. a draft WITHOUT prose prints nothing there — not a blank line under a
 *     heading. The four sections that own their paragraph sit inside a
 *     {#ma_proza_*} wrap, so their paragraph disappears entirely; that is what
 *     the paragraph-count assertion below measures.
 *
 * All text here is synthetic (F-9) — no sentence describes a real property.
 */
function renderText(inputs: KcsInput): string {
  const model = buildDocumentModel({
    ...syntheticDocumentInput(),
    inputs,
    kcs: computeKcs(inputs),
  });
  return docText(renderOperatDocx(model));
}

function docXml(docx: Buffer): string {
  return new PizZip(docx).files["word/document.xml"].asText();
}

function docText(docx: Buffer): string {
  return docXml(docx)
    .replace(/<[^>]+>/g, "")
    .replace(/ /g, " ");
}

function paragraphCount(docx: Buffer): number {
  return (docXml(docx).match(/<w:p[ >]/g) ?? []).length;
}

/** Multi-paragraph prose — `linebreaks: true` turns the \n into <w:br/>. */
const MULTILINE = [
  "Akapit pierwszy sekcji testowej.",
  "Akapit drugi sekcji testowej.",
  "Akapit trzeci sekcji testowej.",
].join("\n\n");

function proseWith(overrides: Partial<Record<string, string>>): ProseSnapshot {
  const base = confirmedProse();
  const sections: ProseSnapshot["sections"] = {};
  for (const section of PROSE_SECTIONS) {
    const text = section in overrides ? overrides[section] : base.sections[section]?.value;
    if (text !== undefined) {
      sections[section] = {
        value: text,
        provenance: { source: "rzeczoznawca", status: "confirmed" },
      };
    }
  }
  return { ...base, sections };
}

describe("T8: buildDocumentModel carries the prose snapshot", () => {
  it("maps every confirmed section onto its {proza_*} field", () => {
    const inputs = { ...goldenInputs(), prose: confirmedProse() };
    const model = buildDocumentModel({ ...syntheticDocumentInput(), inputs });

    for (const section of PROSE_SECTIONS) {
      expect(model[`proza_${section}` as const]).toBe(inputs.prose.sections[section]?.value);
    }
    expect(model.ma_proza_analiza_rynku).toBe(true);
    expect(model.ma_proza_opis_lokalu).toBe(true);
    expect(model.ma_proza_standard).toBe(true);
    expect(model.ma_proza_uzasadnienie).toBe(true);
  });

  it("renders empty strings and false flags when the draft has no prose (legacy / flag off)", () => {
    const model = buildDocumentModel(syntheticDocumentInput());

    for (const section of PROSE_SECTIONS) {
      expect(model[`proza_${section}` as const]).toBe("");
    }
    expect(model.ma_proza_analiza_rynku).toBe(false);
    expect(model.ma_proza_opis_lokalu).toBe(false);
    expect(model.ma_proza_standard).toBe(false);
    expect(model.ma_proza_uzasadnienie).toBe(false);
  });

  it("treats a blank or missing section as absent — no placeholder sentence stands in for it", () => {
    // The flag-off path has no gate (T7), so a half-written snapshot is a real
    // shape here: `standard` blank, `uzasadnienie` never written at all.
    const prose = proseWith({ standard: "   ", uzasadnienie: undefined });
    const model = buildDocumentModel({
      ...syntheticDocumentInput(),
      inputs: { ...goldenInputs(), prose },
    });

    expect(model.proza_standard).toBe("");
    expect(model.ma_proza_standard).toBe(false);
    expect(model.proza_uzasadnienie).toBe("");
    expect(model.ma_proza_uzasadnienie).toBe(false);
    // …while the sections that WERE written are untouched.
    expect(model.ma_proza_opis_lokalu).toBe(true);
    expect(model.proza_otoczenie).not.toBe("");
  });

  it("F-1: prose never reaches the engine — the KCS result is identical with and without it", () => {
    const bare = goldenInputs();
    expect(computeKcs({ ...bare, prose: confirmedProse() })).toEqual(computeKcs(bare));
  });
});

describe("T8: the prose prints in the rendered operat", () => {
  const prose = proseWith({ analiza_rynku: MULTILINE });
  const withProse = renderText({ ...goldenInputs(), prose });

  it("prints every section's text", () => {
    for (const section of PROSE_SECTIONS) {
      const value = prose.sections[section]!.value;
      // Split on newlines: `linebreaks: true` emits <w:br/>, so the extracted
      // text has no \n left to match against.
      for (const line of value.split("\n").filter(Boolean)) {
        expect(withProse, `missing ${section} line: ${line}`).toContain(line);
      }
    }
  });

  it("leaves no stub sentence and no unresolved tag behind", () => {
    expect(withProse).not.toContain("zostanie uzupełniony po oględzinach");
    expect(withProse).not.toContain("zostanie uzupełniona po oględzinach");
    expect(withProse).not.toContain("undefined");
    expect(withProse).not.toMatch(/\{[a-z_#/.]+\}/i);
  });

  it("keeps the static sentences the model does not write", () => {
    // §11: the engine never corrects for elapsed time, so this claim is true
    // in every operat and stays out of the model's hands.
    expect(withProse).toContain("cen ze względu na upływ czasu nie korygowano");
    // §8.1/§8.4: the address sentences the prose tags are appended to.
    expect(withProse).toContain("Wyceniana nieruchomość zlokalizowana jest pod adresem:");
    expect(withProse).toContain(
      "Przedmiotowa nieruchomość lokalowa zlokalizowana jest pod adresem:",
    );
  });
});

describe("T8: honest silence when the draft carries no prose", () => {
  const bare = goldenInputs();

  it("prints no stub, no empty heading — the four wrapped paragraphs are GONE, not blank", () => {
    const withProse = renderOperatDocx(
      buildDocumentModel({
        ...syntheticDocumentInput(),
        inputs: { ...bare, prose: confirmedProse() },
      }),
    );
    const without = renderOperatDocx(buildDocumentModel({ ...syntheticDocumentInput() }));

    // Six: the four {#ma_proza_*}-wrapped prose paragraphs (§11, §8.3 opis
    // lokalu, §8.3 standard, §13) plus the §8.3 "Opis lokalu mieszkalnego"
    // sub-label and its spacer, which the wrap now opens BEFORE. The other two
    // tags are trailing clauses of paragraphs that keep their address sentence
    // either way.
    expect(paragraphCount(withProse) - paragraphCount(without)).toBe(6);
    expect(docText(without)).not.toContain("zostanie uzupełniony po oględzinach");
    expect(docText(without)).not.toMatch(/\{[a-z_#/.]+\}/i);
  });

  // The count above cannot see WHICH paragraphs went, and two independent
  // reviews found the same thing it missed: the §8.3 sub-label stood outside
  // the wrap, so a draft without prose printed a bold heading over nothing and
  // ran straight into §8.4.
  it("prints no heading for a lokal description that is not there", () => {
    const without = docText(renderOperatDocx(buildDocumentModel({ ...syntheticDocumentInput() })));
    const withProse = docText(
      renderOperatDocx(
        buildDocumentModel({
          ...syntheticDocumentInput(),
          inputs: { ...bare, prose: confirmedProse() },
        }),
      ),
    );

    expect(withProse).toContain("Opis lokalu mieszkalnego");
    expect(without).not.toContain("Opis lokalu mieszkalnego");
  });

  // ...and the §1 summary must still state the area. That cell cannot take a
  // block wrap (a table cell whose every paragraph is dropped is invalid
  // OOXML), so it carries an inline inverted fallback. Without it the cell went
  // blank AND {powierzchnia} survived only inside the §12 KCS table — the
  // flat's area would have stopped being a stated fact in the operat and
  // become a calculation input only.
  it("the §1 summary states the area with or without prose, and never twice", () => {
    const without = docText(renderOperatDocx(buildDocumentModel({ ...syntheticDocumentInput() })));
    const withProse = docText(
      renderOperatDocx(
        buildDocumentModel({
          ...syntheticDocumentInput(),
          inputs: { ...bare, prose: confirmedProse() },
        }),
      ),
    );
    const fallback = "Lokal mieszkalny o powierzchni użytkowej";

    // No prose: the fallback speaks, so the area is stated.
    expect(without).toContain(fallback);
    // With prose: the fallback is silent, because the generated opis_lokalu
    // opens with that very sentence and would otherwise print it twice.
    expect(withProse).not.toContain(fallback);
  });

  it("still prints the honest no-map variant (the one 'zostanie uzupełniona' that stays)", () => {
    expect(renderText(bare)).toContain("Dokumentacja kartograficzna zostanie uzupełniona.");
  });
});
