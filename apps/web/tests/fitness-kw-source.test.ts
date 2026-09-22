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
const PLIKI = ["src/app/valuations/new/subject-form.tsx", "src/app/valuations/new/kw-section.tsx"];
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

  it('"ekw_reczne" nie jest wartością zapisywaną — najwyżej jeden odczyt legacy w subject-form', () => {
    expect(
      zrodla["src/app/valuations/new/kw-section.tsx"].match(/["']ekw_reczne["']/g) ?? [],
    ).toEqual([]);
    const wSubjectForm =
      zrodla["src/app/valuations/new/subject-form.tsx"].match(/["']ekw_reczne["']/g) ?? [];
    expect(wSubjectForm.length).toBeLessThanOrEqual(1);
  });

  // W S3a ta asercja jest CELOWO odłożona: Task 3 zostawił skipy z markerem
  // `TODO(gluszyna-s3b)`, które zdejmuje Task 4 w sesji S3b. Wtedy `it.todo`
  // zamienia się w zwykłe `it` z ciałem poniżej i bramka zaczyna pilnować, że
  // żaden test nie został odłożony na stałe:
  //
  //   const testy = fs.readFileSync(path.join(process.cwd(), "tests/rtl-kw-section.test.tsx"), "utf8");
  //   expect(testy).not.toContain("TODO(gluszyna-s3b)");
  it.todo("po sesji S3b nie zostaje żaden test odłożony z S3a");
});
