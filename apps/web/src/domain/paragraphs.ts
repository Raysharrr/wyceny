/**
 * One rule for turning a block of generated prose into the paragraphs the
 * operat prints (M-11, D-36/D-37).
 *
 * Until 16.09 the whole section went into ONE paragraph of the template and
 * docxtemplater's `linebreaks: true` turned every newline into `<w:br/>`.
 * Two defects followed, and both were visible in the 14.09 operat:
 *
 *   - the paragraph is justified (`jc=both`), and Word stretches every line
 *     that ends in a soft break to the full column width — §11 came out as
 *     "Cechy   analizowanego   rynku:" (D-36). The issued Folwarczna operat
 *     still carried nine `<w:br/>` in that one paragraph;
 *   - the model wraps its answer at ~88 columns because the few-shots in its
 *     prompt are wrapped that way, and a wrap that lands between two words
 *     with no space around it glued them together: "od 35,20 m2do 48,67 m2",
 *     "zostałaustalona", "porównańzawierały" (D-37).
 *
 * So a single newline is a WRAP — it joins with a space, which is what the
 * author meant and what repairs the glued words. A blank line is a PARAGRAPH
 * BREAK — it starts a new one. Nothing else survives: the document gets real
 * `<w:p>` elements, never `<w:br/>`, so justification has nothing to stretch.
 *
 * `linebreaks` itself stays ON in the renderer, deliberately: the cover's
 * office block (`{biuro}`) is one field carrying two line breaks, and turning
 * the option off would collapse it onto one line. The fix belongs to the prose
 * that was broken, not to every multi-line field in the document.
 */
export function toParagraphs(text: string | null | undefined): string[] {
  return (
    (text ?? "")
      .replace(/\r\n?/g, "\n")
      // A blank line, or a line that OPENS A LIST ITEM, starts a new paragraph.
      // The list case is not decoration: §11 states its selection criteria as a
      // lead-in and a dash list, and joining those into one line would trade one
      // unreadable §11 for another — measured on a render, not assumed. A wrap
      // never begins with a dash, so the two cases cannot be confused.
      .split(/\n[ \t]*\n+|\n(?=[ \t]*[-–—•*]\s)/)
      .map((para) => para.replace(/\s*\n\s*/g, " ").trim())
      .filter((para) => para !== "")
  );
}

/**
 * The same text for a slot that is NOT a paragraph of its own — the two places
 * where the template continues a literal sentence ("Wyceniana nieruchomość
 * zlokalizowana jest pod adresem: …, {proza_otoczenie}"). A loop there would
 * repeat the literal with every paragraph, so those sections join instead.
 * Still no newline reaches the document, which is the point.
 */
export function toInlineText(text: string | null | undefined): string {
  return toParagraphs(text).join(" ");
}
