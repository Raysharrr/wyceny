/**
 * KW snapshot — what the lokal's land register says, whichever way it was
 * read. Since ADR-018 that is three ways: an uploaded deed (`akt`), an
 * uploaded KW excerpt (`odpis_kw`, both mirrored from the worker's
 * KwExtractPayload) and the appraiser reading eKW in a browser
 * (`ekw_reczne`) — the office's actual practice. One type, because the operat
 * describes an examination, not a file format, and the F-4 gate must not pass
 * on one path while failing on the other (reg. 3, I-13).
 *
 * The last three fields are optional: drafts saved before ADR-018 carry a
 * snapshot without them and are read back unmigrated.
 */
export type KwDzialSnapshot = { wpisy: boolean; tresc: string[] };

/** Dział II — the deed the ownership came from, in the three parts the form asks for (ADR-018 reg. 1, decyzja usera 15.09). */
export type KwAkt = { rodzaj: string; rep: string; data: string };

export type KwSnapshot = {
  source: "akt" | "odpis_kw" | "ekw_reczne";
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
  /**
   * The day the appraiser examined the book. The book never prints it, so it
   * always comes from the form — and the domain never defaults it: a
   * fabricated examination date is the very claim ADR-018 exists to stop.
   */
  dataBadania?: string | null;
  /** Numer lokalu as the book states it (feeds the address comparison, ADR-019). */
  nrLokalu?: string | null;
  akt?: KwAkt | null;
};

/**
 * The grunt's book (księga macierzysta). Deliberately smaller than the
 * lokal's (plan §P1.9): the card asks for a number, an examination date and
 * the two dzialy, so there is nothing here to hold a sąd, a wydział or a
 * transcription. Manual-only in paczka 1 — reading the grunt's PDF is
 * deferred, and `source` is the field that will carry it when it arrives.
 */
export type KwGruntSnapshot = {
  source: "ekw_reczne";
  nrKsiegi: string | null;
  dataBadania: string | null;
  dzial3: KwDzialSnapshot | null;
  dzial4: KwDzialSnapshot | null;
};

/**
 * How the valuation treats an encumbrance found in dział III of the LOKAL's
 * book (ADR-018 reg. 6). A decision about the commission, not a fact of the
 * register — which is why it sits beside the snapshot rather than inside it.
 * `podstawa` is required in both variants: the operat prints it as the
 * assumption behind the figure (§10.1).
 */
export type EncumbranceTreatment = {
  /**
   * `null` = the appraiser has not chosen yet. Expressible on purpose: the
   * form lets them type the basis first, and a shape that could not hold a
   * half-made decision would reject the save on a path no field displays.
   * B-07 keeps blocking until both halves are there.
   */
  wariant: "bez_uwzglednienia" | "z_uwzglednieniem" | null;
  podstawa: string;
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
 * Trims each of the three parts; an akt with nothing in any of them is `null`,
 * not a row of empty strings — that is the difference between "no deed
 * recorded" and "a deed whose title renders as an empty sentence". A partly
 * filled akt survives as typed: an appraiser who has the title but not the
 * Rep. number must not lose what they did enter.
 */
function normalizeAkt(akt: KwAkt | null | undefined): KwAkt | null {
  if (akt == null) return null;
  const trimmed = { rodzaj: akt.rodzaj.trim(), rep: akt.rep.trim(), data: akt.data.trim() };
  return trimmed.rodzaj || trimmed.rep || trimmed.data ? trimmed : null;
}

/**
 * Normalizes a KW snapshot at the action boundary (mirrors the `isEmptySubject`
 * convention): empty-string fields become `null`, and empty/whitespace
 * `tresc`/`kwInne` lines are dropped — so a `""` never persists to render
 * malformed operat sentences (e.g. "Sąd: .") or a phantom KW number, and the
 * F-4 gate sees honest nulls. One implementation for all three sources
 * (ADR-018 reg. 1): hand-typed dzialy get exactly the treatment the
 * extractor's do, so nothing about the operat depends on which path was used.
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
    // `?? null`, never "today": see `dataBadania` above.
    dataBadania: trimToNull(kw.dataBadania ?? null),
    nrLokalu: trimToNull(kw.nrLokalu ?? null),
    akt: normalizeAkt(kw.akt),
  };
}

/**
 * The snapshot's source as a PROVENANCE source (ADR-010). A manual eKW
 * examination is the appraiser's own work, so it maps to `rzeczoznawca` — the
 * kernel's source list describes who produced a value, and nothing produced
 * this but the person typing it. Keeps `ekw_reczne` out of the Shared Kernel,
 * which must not grow beyond provenance.
 */
export function kwProvenanceSource(
  source: KwSnapshot["source"],
): "akt" | "odpis_kw" | "rzeczoznawca" {
  return source === "ekw_reczne" ? "rzeczoznawca" : source;
}

/** The grunt book's counterpart to `normalizeKw` — same rules, fewer fields. */
export function normalizeKwGrunt(kw: KwGruntSnapshot): KwGruntSnapshot {
  return {
    source: kw.source,
    nrKsiegi: trimToNull(kw.nrKsiegi),
    dataBadania: trimToNull(kw.dataBadania),
    dzial3: normalizeDzial(kw.dzial3),
    dzial4: normalizeDzial(kw.dzial4),
  };
}
