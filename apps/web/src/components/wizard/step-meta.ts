export const STEP_META = {
  1: {
    eyebrow: "KROK 1/7 — PRZEDMIOT WYCENY",
    title: "Dane przedmiotu",
    description:
      "Dane pobierane są automatycznie ze źródeł — zweryfikuj, uzupełnij braki; każde pole jest edytowalne.",
    helpSlug: "krok-1-przedmiot",
  },
  2: {
    eyebrow: "KROK 2/7 — OGLĘDZINY",
    title: "Oględziny nieruchomości",
    description: "Jedyny krok, którego nie da się zautomatyzować — zdjęcia i notatka z wizyty.",
    helpSlug: "krok-2-ogledziny",
  },
  3: {
    eyebrow: "KROK 3/7 — DOBÓR PRÓBY TRANSAKCJI",
    title: "Próba porównawcza",
    description: "Pobierz transakcje z RCN i zbuduj próbę (min. 12).",
    helpSlug: "krok-3-proba",
  },
  4: {
    eyebrow: "KROK 4/7 — CECHY RYNKOWE",
    title: "Cechy, oceny i wagi",
    description: "Wagi domyślne dla typu obiektu (lokal) — oceny i wagi należą do Ciebie.",
    helpSlug: "krok-4-cechy",
  },
  5: {
    eyebrow: "KROK 5/7 — KALKULACJA",
    title: "Kalkulacja i wynik",
    description: "Każda liczba ma widoczne źródło i wzór — Tabele 1–4 trafiają wprost do operatu.",
    helpSlug: "krok-5-kalkulacja",
  },
  6: {
    eyebrow: "KROK 6/7 — SEKCJE OPISOWE",
    title: "Sekcje opisowe",
    description:
      "Propozycje powstają automatycznie z danych tej wyceny — przeczytaj, popraw i zatwierdź.",
    helpSlug: "krok-6-opisy",
  },
  7: {
    eyebrow: "KROK 7/7 — PODGLĄD OPERATU",
    title: "Operat szacunkowy",
    description:
      "Obejrzyj złożony dokument i zatwierdź operat — wydany PDF powstanie na nowo, z datą wydania.",
    helpSlug: "krok-7-operat",
  },
} as const;
