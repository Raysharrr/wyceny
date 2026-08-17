# Plan slice'a — Proza operatu z LLM (FR-6 przyspieszone)

Spec: `../specs/2026-08-17-proza-operatu-llm-design.md` · Decyzja: wiki ADR-014 ·
Spike PASS: wiki `tools/spike/2026-08-17-proza-operatu/` · Konwencja: SDD (świeży
implementer + niezależny reviewer per task), TDD, golden F-1 nietykalny.

## Cel (DoD slice'a)

Krok 6 przestaje być placeholderem: przy wejściu propozycje 6 sekcji opisowych generują
się automatycznie z danych wyceny (worker→Anthropic), wchodzą jako `ai`/`to_verify`,
rzeczoznawca edytuje/zatwierdza (F-4 blokuje bez tego), zatwierdzone teksty renderują się
w operacie z nowych tagów `{proza_*}` — z szablonu znikają literały Kościelnej i stuby.
Golden F-1 = 1 044 400 zł byte-identical; wszystkie fitness functions zielone; koszt
generacji widoczny w audycie.

## Taski (kolejność = zależności)

- **T0 — Audyt szablonu (read-only, wiki+app).** Inwentarz WSZYSTKICH statycznych
  literałów Kościelnej i stubów w sekcjach opisowych `templates/operat-szablon.docx`
  (unzip + diff z inwentarzem specu); wynikowa lista tagów `{proza_*}` i miejsc wstawienia.
  DoD: tabela literał→tag w raporcie taska; bez zmian kodu.
- **T1 — Kernel: źródło `ai`.** Rozszerzenie zamkniętego enumu źródeł w `@wyceny/shared`
  - testy typów/parsera. DoD: `ai` przechodzi roundtrip Sourced, stare źródła nietknięte.
- **T2 — Worker: rdzeń `prose.py` (pure).** Budowa promptu z plików
  `app/prompts/prose/` (styl+few-shot+JSON faktów); **deterministyczny trend cen**
  (średnie połówek okresu, |Δ|<5% = „stabilne"); **walidator liczb** portowany ze spike'a
  z pułapkami (cyfra w „m2", liczby łamane wierszem, idiom „za 1 m2", nagłówki).
  DoD: pytest bez API (fixtures), walidator łapie wstrzykniętą obcą liczbę (test mutacyjny).
- **T3 — Worker: `POST /prose-proposal`.** Token HMAC (wzorzec kw-extract), jedyny
  anthropic-touchpoint wzorcem `_extract_kw_payload` (sonnet-5, thinking disabled),
  runtime-walidacja liczb → 502 „spróbuj ponownie" przy odrzuceniu; zwraca
  `{sekcje, model, usage:{input_tokens,output_tokens}}`. DoD: pytest z monkeypatchem;
  F-11 (zero WR w wejściu/wyjściu) testem.
- **T4 — Prompty produkcyjne (F-9!).** `app/prompts/prose/*.md`: drogowskaz ze spike'a
  - few-shot **syntetyczny** (fikcyjny adres/liczby w stylu kancelarii — repo publiczne,
    zakaz fragmentów realnych operatów). DoD: `check-no-pii.sh` zielony; ręczna generacja
    na fixture daje rejestr operatowy (snapshot w teście).
- **T5 — Web: port/adapter + akcja.** `PortProse` + adapter HTTP + server action
  `proposeProse(valuationId)`: mint token, call worker, zapis propozycji jako
  `ai`/`to_verify` do draftu (wzorzec tx+FOR UPDATE+audyt: akcja `prose_generated`
  z `usage` w meta — licznik kosztów). **Auto-trigger**: wejście na krok 6 bez
  aktualnych propozycji odpala generację (loading state); zmiana danych wejściowych
  inwaliduje propozycje (wzorzec inwalidacji WR ze Slice 11a). DoD: RTL testy stanu
  loading/właściwej inwalidacji; brak double-fire przy nawigacji (guard stale-response
  wzorcem Slice 5).
- **T6 — Web: krok 6 UI.** Edytowalne pola per sekcja + badge prowenancji + **stała
  adnotacja odpowiedzialności**; edycja → `confirmed` (rzeczoznawca); „Wygeneruj
  ponownie"; kill-switch `NEXT_PUBLIC_PROSE=off` → dzisiejszy placeholder. DoD: RTL;
  smoke e2e (flagą off) nietknięty zielony.
- **T7 — Brama i zamrożenie.** F-4: niezatwierdzone opisy = blocker; zatwierdzone teksty
  w write-once `inputs.prose` (zero DDL); approve↔sign renderują ze snapshotu (rozszerzyć
  strażnika równości tekstu). DoD: test tamperingu API (approve z `ai`-to_verify odbity).
- **T8 — Dokument.** `buildDocumentModel` + nowe tagi `{proza_*}`; etap w
  `build_template.py` (wiki-repo) usuwa literały z T0; **F-12** + nowe tagi + strażnik
  „zero starych literałów Kościelnej". DoD: F-12 zielony, golden byte-identical.
- **T9 — Pomoc (docs-loop).** Strona kroku 6 przepisana (jak działa generacja, skąd
  fakty, odpowiedzialność), akapit metodyczny. DoD: mutacja stałej → zmiana treści.
- **T10 — QA staging.** Pełny cykl na nowej wycenie (auto-generacja → edycja → approve →
  operat bez literałów Kościelnej), weryfikacja bajtowa dokumentu + wpisów audytu
  z kosztami. DoD: raport QA + zrzuty.

## Ryzyka / uwagi

- **F-9**: few-shot tylko syntetyczny (repo publiczne) — review T4 pod tym kątem.
- Auto-trigger na RSC: generacja z akcji klienckiej po mount (nie w renderze RSC) —
  unikamy side-effectów w renderze i podwójnych wywołań.
- Koszt: ~2,5–3k tok wejścia + ~0,4k wyjścia × 6 sekcji ≈ 0,3–0,4 zł/komplet (sonnet-5);
  raportowane w audycie per generacja.
- Sekcje bez danych (pusta notatka) → propozycja pomija wątek; UI pokazuje pusty edytor
  z hintem (uczciwa cisza jak dotąd).
