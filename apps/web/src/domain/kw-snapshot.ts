/**
 * KW snapshot — what the lokal's land register says, whichever way it was
 * read. Since ADR-021 that is three live ways: an uploaded deed (`akt`), one
 * or more uploaded KW PDFs (`odpis_kw`, mirrored from the worker's
 * KwExtractPayload) and the content pasted out of the eKW browser
 * (`ekw_wklej`) — plus `ekw_reczne`, kept for reading snapshots saved before
 * ADR-021, when the appraiser typed the dzialy by hand. One type, because the
 * operat describes an examination, not a file format, and the F-4 gate must
 * not pass on one path while failing on the other (reg. 3, I-13).
 *
 * The last three fields are optional: drafts saved before ADR-018 carry a
 * snapshot without them and are read back unmigrated.
 */
import type { KsiegaTresc } from "./kw-tresc";

export type KwDzialSnapshot = { wpisy: boolean; tresc: string[] };

/** Dział II — the deed the ownership came from, in the three parts the form asks for (ADR-018 reg. 1, decyzja usera 15.09). */
export type KwAkt = { rodzaj: string; rep: string; data: string };

/**
 * Skąd weszła treść. `ekw_reczne` — WYŁĄCZNIE odczyt migawek sprzed ADR-021;
 * nowy zapis nigdy (fitness `tests/fitness-kw-source.test.ts`).
 */
export type KwSource = "akt" | "odpis_kw" | "ekw_wklej" | "ekw_reczne";
export type KwKanal = "pdf" | "tekst";

/**
 * Werdykt deterministycznej walidacji workera, zapisany PRZY migawce, którą
 * ocenia (ADR-021 reg. 4) — trwałe ostrzeżenie w kroku 1 i w podglądzie, nie
 * blokada. Klasy i kody działów tylko; `kw_validate.py` nie wkłada do klasy
 * żadnej wartości z księgi (F-13).
 */
export type KwWerdykt = {
  ok: boolean;
  bledy: Array<{ klasa: string; dzial?: string }>;
  kanal: KwKanal;
  plikow: number;
  at: string;
};

export type KwSnapshot = {
  source: KwSource;
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
  /**
   * The full content of the book's five dzialy, as §8.2 prints it — written
   * whenever a transcription came back, through either channel, and REGARDLESS
   * of the validators' verdict (ADR-021 reg. 5): a failed check is a warning
   * for the appraiser, not a reason to drop what the book says. The verdict
   * itself rides in `transkrypcja` beside it. Never typed by hand — there is no
   * hand-typed path any more, and `dzial3`/`dzial4` are computed from this
   * content (`dzialyZTresci`).
   *
   * Carries persons' data on purpose (ADR-018 "Zmiana 15.09") — which is why
   * it lives HERE, inside the valuation's `inputs`, and nowhere else: no log,
   * no event, no fixture that is not fictional (F-13).
   */
  tresc?: KsiegaTresc | null;
  /** Werdykt walidacji tej transkrypcji; `null`/brak = transkrypcji nie było albo padła. */
  transkrypcja?: KwWerdykt | null;
};

/**
 * Księga gruntu w kształcie księgi lokalu (ADR-021, refaktor R2): te same
 * kanały, ta sama treść, ten sam werdykt. Cztery ostatnie pola są OPCJONALNE,
 * bo model dokumentu czyta `inputs.kwGrunt` prosto z bazy — migawki sprzed
 * ADR-021 ich nie mają; `coerceLegacyKwGrunt` (`Required<>`) wymusza ich
 * wyliczenie na granicy formularza.
 */
export type KwGruntSnapshot = {
  source: Exclude<KwSource, "akt">;
  nrKsiegi: string | null;
  dataBadania: string | null;
  dzial3: KwDzialSnapshot | null;
  dzial4: KwDzialSnapshot | null;
  sad?: string | null;
  wydzial?: string | null;
  tresc?: KsiegaTresc | null;
  transkrypcja?: KwWerdykt | null;
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
    // `tresc` is carried by the spread above and deliberately NOT normalized.
    // Two reasons: its strings are the eKW text VERBATIM (spacing around "/",
    // the kind of dash, leading zeros — trimming them would be corruption, not
    // tidying), and leaving the key untouched keeps a draft saved before this
    // field byte-identical, so `sameSubjectGroup` does not lapse a whole
    // confirmed step-1 group on its first re-save.
  };
}

/** Tyle migawki, ile potrzeba do rozstrzygnięcia proweniencji — reszta nieistotna. */
export type KwProvenanceInput = Pick<KwSnapshot, "source"> &
  Partial<Pick<KwSnapshot, "tresc" | "transkrypcja">>;

/**
 * Czy odczyt w ogóle się odbył — NIEZALEŻNIE od kanału, na którym stała karta
 * (decyzja koordynatora 22.09, finding F1). Trzy ślady, każdy wystarczy:
 * werdykt walidatora, przepisana treść albo metryka odczytu pól z
 * `/kw-extract`. Ich brak znaczy, że pola wpisał człowiek z klawiatury —
 * choćby karta stała wtedy na „Wgraj PDF".
 */
export function kwPrzepisano(kw: KwProvenanceInput, kwMeta?: KwMetaSnapshot | null): boolean {
  return kw.transkrypcja != null || kw.tresc != null || kwMeta != null;
}

/**
 * The snapshot's source as a PROVENANCE source (ADR-010). The question is
 * never which channel the card stood on — it is whether anything was READ. If
 * it was, the program filled the fields and they enter `to_verify` like a
 * document's, under the deed's name for a deed and the excerpt's name for
 * everything else. If it was not, the appraiser typed them off the screen and
 * they are their own work (`rzeczoznawca`), exactly as `ekw_reczne` always was
 * (ADR-018 reg. 1).
 *
 * That is why `odpis_kw` has no early return: a card switched to „Wgraj PDF"
 * with a number typed into it and no file attached carries `source:
 * "odpis_kw"` and nothing else, and stamping it against a document nobody held
 * is the very claim ADR-018 exists to stop (finding F1).
 *
 * Keeps the eKW sources out of the Shared Kernel, which must not grow beyond
 * provenance.
 */
export function kwProvenanceSource(
  kw: KwProvenanceInput,
  kwMeta?: KwMetaSnapshot | null,
): "akt" | "odpis_kw" | "rzeczoznawca" {
  if (!kwPrzepisano(kw, kwMeta)) return "rzeczoznawca";
  return kw.source === "akt" ? "akt" : "odpis_kw";
}

/** The grunt book's counterpart to `normalizeKw` — same rules, fewer fields. */
export function normalizeKwGrunt(kw: KwGruntSnapshot): KwGruntSnapshot {
  return {
    // Spread, nie wyliczanie pól po kolei: `tresc` i `transkrypcja` jadą
    // nietknięte (jak w `normalizeKw`), a pole dodane jutro nie zginie tu po
    // cichu. Pola opcjonalne przepisujemy tylko wtedy, gdy migawka je ma —
    // stara migawka pięciopolowa wraca pięciopolowa, bez dorobionych null-i.
    ...kw,
    nrKsiegi: trimToNull(kw.nrKsiegi),
    dataBadania: trimToNull(kw.dataBadania),
    dzial3: normalizeDzial(kw.dzial3),
    dzial4: normalizeDzial(kw.dzial4),
    ...(kw.sad !== undefined ? { sad: trimToNull(kw.sad) } : {}),
    ...(kw.wydzial !== undefined ? { wydzial: trimToNull(kw.wydzial) } : {}),
  };
}
