import { describe, expect, it } from "vitest";
import { buildDocumentModel } from "../src/domain/document-model";
import { authorFrom } from "../src/domain/document-input";
import { AUTOR_TESTOWY, syntheticDocumentInput } from "./fixtures/document-model-fixture";

/**
 * ADR-020 cz. 1: the operat's author, licence number and office block come
 * from the profile of whoever is logged in. Before this, all three were
 * literals in the DOCX template, which is how the QA account issued a document
 * carrying another appraiser's name, licence and stamp.
 *
 * Wszystkie dane poniżej są FIKCYJNE (F-9, ryzyko R10 specu).
 */
describe("model dokumentu — blok autora (ADR-020 cz. 1)", () => {
  it("niesie imię i nazwisko, uprawnienia i dane biura z profilu", () => {
    const model = buildDocumentModel(syntheticDocumentInput());
    expect(model.autor_imie_nazwisko).toBe("Jan Testowy");
    expect(model.autor_uprawnienia).toBe("0000");
    expect(model.biuro).toBe("Biuro Wycen Testowe\nul. Przykładowa 1\n60-000 Poznań");
  });

  /**
   * Podgląd kroku 7 działa przy brakach (spec §4), więc niekompletny profil
   * MUSI dać się wyrenderować. Myślnik jest tu jedyną uczciwą odpowiedzią —
   * a B-15 pilnuje, żeby taki dokument nigdy nie został wydany.
   */
  it("niekompletny profil renderuje myślniki, nie cudze dane", () => {
    const model = buildDocumentModel({
      ...syntheticDocumentInput(),
      author: authorFrom(null),
    });
    expect(model.autor_imie_nazwisko).toBe("—");
    expect(model.autor_uprawnienia).toBe("—");
    expect(model.biuro).toBe("—");
  });

  it("puste pola profilu też dają myślnik (wiersz istnieje, dane nie)", () => {
    const model = buildDocumentModel({
      ...syntheticDocumentInput(),
      author: authorFrom({
        fullName: null,
        licenseNo: null,
        officeBlock: null,
        insuranceDocKey: "polisa/x",
        insuranceValidUntil: "2099-12-31",
      }),
    });
    expect(model.autor_imie_nazwisko).toBe("—");
  });

  it("bez polisy lista stron Załącznika nr 1 jest pusta", () => {
    expect(buildDocumentModel(syntheticDocumentInput()).polisa_strony).toEqual([]);
  });

  /**
   * Strony polisy jadą przez model jako MARKERY, tak jak zdjęcia z oględzin —
   * bajty obrazów nigdy nie wchodzą do modelu, są rozdzielane po markerze w
   * `docx-render.ts`. Kolejność stron jest kolejnością w dokumencie (D-60).
   */
  it("każda strona polisy dostaje marker w kolejności dokumentu", () => {
    const model = buildDocumentModel({
      ...syntheticDocumentInput(),
      author: {
        ...AUTOR_TESTOWY,
        policyPages: [Buffer.from("s1"), Buffer.from("s2"), Buffer.from("s3")],
      },
    });
    expect(model.polisa_strony).toEqual([
      { img: "polisa-0" },
      { img: "polisa-1" },
      { img: "polisa-2" },
    ]);
  });
});

describe("authorFrom — profil → blok autora", () => {
  it("zamienia braki na puste napisy, zamiast odmawiać (podgląd musi działać)", () => {
    expect(authorFrom(null)).toEqual({
      fullName: "",
      licenseNo: "",
      officeBlock: "",
      policyPages: [],
    });
  });

  it("przepisuje komplet danych profilu bez zmian", () => {
    expect(
      authorFrom({
        fullName: "Anna Fikcyjna",
        licenseNo: "1234",
        officeBlock: "Biuro Fikcyjne",
        insuranceDocKey: "polisa/y",
        insuranceValidUntil: "2099-12-31",
      }),
    ).toEqual({
      fullName: "Anna Fikcyjna",
      licenseNo: "1234",
      officeBlock: "Biuro Fikcyjne",
      policyPages: [],
    });
  });
});
