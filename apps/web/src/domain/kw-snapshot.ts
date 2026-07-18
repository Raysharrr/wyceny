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
