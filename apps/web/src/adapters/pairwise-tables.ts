/** Resize only the three caption-marked, rectangular PP tables before templating. */
export function resizePairwiseTables(xml: string, count: number): string {
  if (![3, 4, 5].includes(count)) throw new Error("PP requires 3–5 columns");
  const marked = new Set<number>();
  const output = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (table) => {
    const marker = table.match(/<w:tblCaption w:val="pp-dynamic-([123])"\s*\/>/);
    if (!marker) return table;
    const fixed = Number(marker[1]);
    if (marked.has(fixed)) throw new Error("Duplicate PP table marker");
    marked.add(fixed);
    if (/<w:(?:gridSpan|vMerge|hMerge)\b/.test(table))
      throw new Error("Merged PP cells are unsupported");
    const grid = table.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/)?.[0];
    if (!grid || (grid.match(/<w:gridCol\b/g) ?? []).length !== fixed + 5)
      throw new Error("Unexpected PP grid");
    const widths = Array.from({ length: fixed + count }, (_, i) =>
      i === 0 ? 2600 : Math.floor(6400 / (fixed + count - 1)),
    );
    widths[widths.length - 1] += 9000 - widths.reduce((a, b) => a + b, 0);
    let rows = 0;
    const resized = table
      .replace(
        grid,
        `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`,
      )
      .replace(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g, (row) => {
        rows++;
        const cells = row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [];
        if (
          cells.length !== fixed + 5 ||
          cells.some((c) => (c.match(/<w:tcW\b/g) ?? []).length !== 1)
        )
          throw new Error("Unexpected PP row shape");
        const closing = row.match(/\{\/(pp_rows|pp_corrections|pp_prices)\}/)?.[0];
        let index = 0;
        return row.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, (cell) => {
          const i = index++;
          if (i >= fixed + count) return "";
          if (closing && count < 5 && i === fixed + count - 1)
            cell = cell.replace("</w:t>", closing + "</w:t>");
          return cell.replace(/<w:tcW[^>]*\/>/, `<w:tcW w:w="${widths[i]}" w:type="dxa"/>`);
        });
      });
    if (rows < 2) throw new Error("PP table has no data rows");
    return resized;
  });
  if (marked.size !== 3) throw new Error("Expected exactly three dynamic PP tables");
  return output;
}
