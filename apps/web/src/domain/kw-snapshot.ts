/**
 * KW snapshot (Slice 6) — the PII-minimized extract from an uploaded deed
 * (akt) or KW excerpt (odpis_kw), mirrored from the worker's
 * KwExtractPayload. Exists ONLY for document-sourced data; manual entry
 * keeps using the flat `kwNumber` field.
 */
export type KwDzialSnapshot = { wpisy: boolean; tresc: string[] };

export type KwSnapshot = {
  source: "akt" | "odpis_kw";
  kwLokalu: string | null;
  kwGruntu: string | null;
  kwInne: string[];
  deweloperski: boolean;
  powUzytkowaKw: number | null;
  udzial: string | null;
  sad: string | null;
  wydzial: string | null;
  dataDokumentu: string | null;
  dzial3: KwDzialSnapshot | null;
  dzial4: KwDzialSnapshot | null;
};

export type KwMetaSnapshot = {
  model: string;
  extractedAt: string;
  docTypeDetected: "akt" | "odpis_kw";
  docTypeDeclared: "akt" | "odpis_kw";
};

/** ""/whitespace → null; otherwise the trimmed string. */
function trimToNull(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Drops empty/whitespace-only entries; keeps `wpisy` untouched (see below). */
function normalizeDzial(dzial: KwDzialSnapshot | null): KwDzialSnapshot | null {
  if (dzial == null) return dzial;
  // Deliberately DO NOT flip `wpisy` to false when the filtered `tresc` is
  // empty: that would fabricate a "brak wpisów" (clean-title/no-mortgage)
  // claim. The document model renders neither the brak sentence nor the loop
  // when `wpisy` is true but `tresc` is [] — acceptable honest silence.
  return {
    wpisy: dzial.wpisy,
    tresc: dzial.tresc.map((t) => t.trim()).filter((t) => t.length > 0),
  };
}

/**
 * Normalizes a document-sourced KW snapshot at the action boundary (mirrors
 * the `isEmptySubject` convention): empty-string fields the extractor may emit
 * become `null`, and empty/whitespace `tresc`/`kwInne` lines are dropped — so
 * a `""` never persists to render malformed operat sentences (e.g. "Sąd: .")
 * or a phantom KW number, and the F-4 gate sees honest nulls. Lives here
 * (rather than duplicated per call site) so every caller — the wizard's
 * step-1 actions (Slice 11a, Task 5) included — shares one implementation.
 */
export function normalizeKw(kw: KwSnapshot): KwSnapshot {
  return {
    ...kw,
    kwLokalu: trimToNull(kw.kwLokalu),
    kwGruntu: trimToNull(kw.kwGruntu),
    udzial: trimToNull(kw.udzial),
    sad: trimToNull(kw.sad),
    wydzial: trimToNull(kw.wydzial),
    dataDokumentu: trimToNull(kw.dataDokumentu),
    kwInne: kw.kwInne.map((s) => s.trim()).filter((s) => s.length > 0),
    dzial3: normalizeDzial(kw.dzial3),
    dzial4: normalizeDzial(kw.dzial4),
  };
}
