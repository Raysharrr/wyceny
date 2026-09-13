import { describe, it, expect } from "vitest";
import fs from "node:fs";
import PizZip from "pizzip";
import { resizePairwiseTables } from "../src/adapters/pairwise-tables";
const xml = new PizZip(fs.readFileSync("templates/operat-szablon.docx"))
  .file("word/document.xml")!
  .asText();
const tables = (xml: string) => xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
describe("narrow PP table adapter", () => {
  it.each([3, 4, 5])(
    "preserves unmarked XML verbatim and matches widths for %i columns",
    (count) => {
      const output = resizePairwiseTables(xml, count);
      const unchanged = (value: string) =>
        tables(value).filter((t) => !t.includes('w:val="pp-dynamic-'));
      expect(unchanged(output)).toEqual(unchanged(xml));
      for (const table of tables(output).filter((t) => t.includes('w:val="pp-dynamic-'))) {
        const widths = [...table.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
        expect(widths.reduce((a, b) => a + b, 0)).toBe(9000);
        for (const row of table.match(/<w:tr[\s\S]*?<\/w:tr>/g) ?? [])
          expect([...row.matchAll(/<w:tcW w:w="(\d+)"/g)].map((m) => Number(m[1]))).toEqual(widths);
      }
    },
  );
  it("fails closed for unexpected count, missing tables and malformed grid", () => {
    expect(() => resizePairwiseTables(xml, 2)).toThrow();
    expect(() => resizePairwiseTables(xml.replace("pp-dynamic-2", "removed-marker"), 3)).toThrow();
    const broken = xml.replace(
      /(<w:tblCaption w:val="pp-dynamic-2"[\s\S]*?<w:tblGrid>)<w:gridCol[^>]*\/>/,
      "$1",
    );
    expect(() => resizePairwiseTables(broken, 3)).toThrow(/grid/);
  });
});
