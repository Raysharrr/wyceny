import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR-021: ścieżka ręczna nie istnieje. `ekw_reczne` zostaje w typach i
 * schematach do ODCZYTU starych migawek; żaden kod kroku 1 nie może go już
 * ZAPISAĆ, a `"reczny"` (dawny klucz sekcji) nie może istnieć wcale. Test na
 * tekście źródeł z wyciętymi komentarzami — zapis to literał w kodzie, nie w
 * komentarzu opisującym historię.
 */
/** Krok 1: karta i formularz. Tu `ekw_reczne` nie ma prawa paść ani razu. */
const PLIKI = ["src/app/valuations/new/subject-form.tsx", "src/app/valuations/new/kw-section.tsx"];

/**
 * Jedyny plik, w którym literał `"ekw_reczne"` jest DOZWOLONY, i tylko w tej
 * jednej roli: `coerceLegacyKwGrunt` domyśla go migawce gruntu sprzed ADR-021,
 * która źródła nie miała. To odczyt, nie zapis — bramka patrzy tu właśnie po
 * to, żeby ktoś nie dopisał obok drugiego, już zapisującego (finding F5).
 */
const WYJATEK_LEGACY = "src/lib/subject-form.ts";
const bezKomentarzy = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("fitness: kanały KW bez ścieżki ręcznej", () => {
  const zrodla = Object.fromEntries(
    PLIKI.map((p) => [p, bezKomentarzy(fs.readFileSync(path.join(process.cwd(), p), "utf8"))]),
  );

  it('"reczny" nie występuje w kodzie kroku 1', () => {
    for (const [plik, tekst] of Object.entries(zrodla)) {
      expect(tekst.match(/["']reczny["']/g) ?? [], plik).toEqual([]);
    }
  });

  it('"ekw_reczne" nie pada w kroku 1 ANI RAZU — nic go już nie zapisuje', () => {
    for (const [plik, tekst] of Object.entries(zrodla)) {
      expect(tekst.match(/["']ekw_reczne["']/g) ?? [], plik).toEqual([]);
    }
  });

  it("jedyny dozwolony literał legacy to domyślne źródło w coerceLegacyKwGrunt", () => {
    const tekst = bezKomentarzy(fs.readFileSync(path.join(process.cwd(), WYJATEK_LEGACY), "utf8"));
    // Dokładnie jeden — drugi znaczyłby, że ktoś dopisał ZAPIS obok odczytu.
    expect(tekst.match(/["']ekw_reczne["']/g) ?? []).toHaveLength(1);
    expect(tekst).toContain('kwGrunt.source ?? "ekw_reczne"');
    expect(tekst.match(/["']reczny["']/g) ?? []).toEqual([]);
  });

  /**
   * Uzbrojone w S3b (Task 4 Step 5): skipy z markerem `TODO(gluszyna-s3b)` są
   * zdjęte — każdy przepisany albo usunięty. Bramka pilnuje, żeby nie wróciły
   * ani one, ani żaden inny odłożony test w tym pliku: odłożony test kroku 1 to
   * reguła, której nikt już nie mierzy.
   *
   * Wzorzec obejmuje `describe`/`test`/`it` i kończy się na `\b`, a nie na
   * nawiasie — inaczej `describe.skip(`, `test.skip(` i `it.skip.each(`
   * przeszłyby przez bramkę bez szmeru (finding F6 z review PR #83).
   */
  it("po sesji S3b nie zostaje żaden test odłożony z S3a", () => {
    const testy = fs.readFileSync(
      path.join(process.cwd(), "tests/rtl-kw-section.test.tsx"),
      "utf8",
    );
    expect(testy).not.toContain("TODO(gluszyna-s3b)");
    expect(testy.match(/\b(it|test|describe)\.(skip|todo)\b/g) ?? []).toEqual([]);
  });
});
