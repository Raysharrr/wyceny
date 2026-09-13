const { createRequire } = require("node:module");
const requireApp = createRequire(
  require("node:path").resolve(__dirname, "../../../apps/web/package.json"),
);
const PizZip = requireApp("pizzip");
const Docxtemplater = requireApp("docxtemplater");
const fs = require("node:fs");
const root = process.env.PP_SPIKE_OUTPUT_DIR || "/tmp/pp-column-spike";
fs.mkdirSync(root, { recursive: true });
const text = (s) =>
  `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${s}</w:t></w:r></w:p>`;
const cell = (s) => `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr>${text(s)}</w:tc>`;
const row = (ss) => `<w:tr>${ss.map(cell).join("")}</w:tr>`;
function table(caption, fixed, rows) {
  return (
    text(caption) +
    `<w:tbl><w:tblPr><w:tblCaption w:val="pp-dynamic-${fixed}"/><w:tblW w:w="9600" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((x) => `<w:${x} w:val="single" w:sz="4" w:color="999999"/>`).join("")}</w:tblBorders></w:tblPr><w:tblGrid>${Array(
      fixed + 5,
    )
      .fill('<w:gridCol w:w="1200"/>')
      .join("")}</w:tblGrid>${rows.map(row).join("")}</w:tbl>`
  );
}
const comps = (f) => Array.from({ length: 5 }, (_, i) => f(i));
const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text("PP — synthetic column spike / {count} comparables")}${table("Table 1. Ratings", 2, [["Feature", "Subject", ...comps((i) => `Comparable ${i + 1}`)], ...["Location", "Area", "Condition", "Additional amenities"].map((s, j) => [s, "Good", ...comps((i) => `{rating_${j}_${i}}`)])])}${table("Table 2. Corrections", 3, [["Feature", "Weight", "Range", ...comps((i) => `Comparable ${i + 1}`)], ...["Location", "Area", "Condition", "Additional amenities"].map((s, j) => [s, ["40%", "30%", "20%", "10%"][j], ["400", "300", "200", "100"][j], ...comps((i) => `{correction_${j}_${i}}`)])])}${table(
  "Table 3. Corrected prices",
  1,
  [
    ["Price / correction", ...comps((i) => `Comparable ${i + 1}`)],
    ["Price", ...comps((i) => `{price_${i}}`)],
    ["Correction", ...comps((i) => `{sum_${i}}`)],
    ["Corrected price", ...comps((i) => `{corrected_${i}}`)],
  ],
)}${text("Table 4. Result")}${text("Mean corrected price: {mean}; area: 54; value: {value}")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1100" w:bottom="1000" w:left="1100"/></w:sectPr></w:body></w:document>`;
function resize(source, n) {
  return source.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (t) => {
    const m = t.match(/<w:tblCaption w:val="pp-dynamic-(\d+)"/);
    if (!m) return t;
    const fixed = +m[1];
    const widths = Array.from({ length: fixed + n }, (_, i) =>
      i === 0 ? 2400 : Math.floor(7200 / (fixed + n - 1)),
    );
    widths[widths.length - 1] += 9600 - widths.reduce((a, b) => a + b, 0);
    return t
      .replace(
        /<w:tblGrid>[\s\S]*?<\/w:tblGrid>/,
        `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`,
      )
      .replace(/<w:tr>[\s\S]*?<\/w:tr>/g, (r) => {
        const cells = r.match(/<w:tc>[\s\S]*?<\/w:tc>/g);
        if (cells.length !== fixed + 5) throw Error("Unexpected table shape");
        return (
          "<w:tr>" +
          cells
            .slice(0, fixed + n)
            .map((c, i) => c.replace(/<w:tcW[^>]*\/>/, `<w:tcW w:w="${widths[i]}" w:type="dxa"/>`))
            .join("") +
          "</w:tr>"
        );
      });
  });
}
const report = [];
for (const n of [3, 4, 5]) {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file("word/document.xml", resize(xml, n));
  const data = { count: n };
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let correction = 0;
    for (let j = 0; j < 4; j++) {
      data[`rating_${j}_${i}`] = i % 2 ? "Good" : "Average";
      data[`correction_${j}_${i}`] = j === 0 ? 100 : 0;
      correction += data[`correction_${j}_${i}`];
    }
    data[`price_${i}`] = 9500 + i * 200;
    data[`sum_${i}`] = correction;
    data[`corrected_${i}`] = data[`price_${i}`] + correction;
    sum += data[`corrected_${i}`];
  }
  data.mean = sum / n;
  data.value = Math.round((data.mean * 54) / 100) * 100;
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.render(data);
  const out = doc.getZip();
  const rendered = out.file("word/document.xml").asText();
  if (/[{}]|undefined/.test(rendered)) throw Error("Unresolved content");
  let idx = 0;
  for (const t of rendered.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)) {
    const fixed = [2, 3, 1][idx++];
    if ((t.match(/<w:gridCol /g) || []).length !== fixed + n) throw Error("grid");
    for (const r of t.match(/<w:tr>[\s\S]*?<\/w:tr>/g)) {
      if ((r.match(/<w:tc>/g) || []).length !== fixed + n) throw Error("cells");
    }
    if (n < 5 && t.includes(`Comparable ${n + 1}`)) throw Error("extra comparable");
  }
  fs.writeFileSync(`${root}/pp-${n}.docx`, out.generate({ type: "nodebuffer" }));
  fs.writeFileSync(`${root}/pp-${n}.xml`, rendered);
  report.push({
    count: n,
    columns: [2 + n, 3 + n, 1 + n],
    mean: data.mean,
    value: data.value,
    xml: "PASS",
  });
}
fs.writeFileSync(`${root}/results.json`, JSON.stringify(report, null, 2));
console.log(report);
