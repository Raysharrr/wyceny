# Spec: Cechy/oceny/wagi — preset z worka cech + definicje skali ocen (Slice 7, F-6)

- **Data:** 2026-07-18 · **Status:** zaakceptowany w brainstormie (checkpoint a — zakres ✅)
- **Roadmapa:** 🟢 NOW „Cechy/oceny/wagi (F-6)" — `Must-Viable`; realizuje FR-4 (PRD) + AC-8; wzorzec ADR-006
- **Bez spike'a:** zero nowych integracji zewnętrznych — slice czysto domenowo-formularzowy

## Opis produktowy — co budujemy z perspektywy użytkownika

Dziś sekcja „Cechy i wagi" formularza to sztywna szóstka: sześć wpisanych na
stałe cech lokalu z wagami 40/30/10/10/4/6, przy których rzeczoznawca może
zmienić tylko procenty i oceny. Tymczasem na warsztacie padło wprost: „nie
zawsze jest pięć cech" — gdy wszystkie transakcje z próby leżą na parterze,
położenie na piętrze przestaje być cechą różnicującą i nie powinno być
w operacie („pole do zaczepienia… pancerz obronny").

Po tym slice'u sekcja pracuje na **worku cech**: sześć cech podstawowych
z listy Anety jest aktywnych od razu (z dotychczasowymi wagami), a trzy
wyjątkowe — funkcjonalność lokalu, liczba izb, rodzaj zabudowy — czekają
w puli. Rzeczoznawca może dodać cechę z puli i usunąć niepotrzebną (wraca do
puli); cechy spoza operatu po prostu w nim nie występują. Suma wag musi jak
dotąd wynosić 100%.

Nowością są **definicje skali ocen**: przy każdej cesze rozwijany panel
z tekstami opisującymi, co znaczy ocena „gorsza", „przeciętna", „lepsza" dla
tej konkretnej wyceny — dokładnie takie definicje, jakie Aneta wpisuje
w sekcji 9.1 operatów sądowych. Aplikacja proponuje sensowne defaulty
(wyprowadzone z operatów Kościelna i Gościejewko), a rzeczoznawca je
akceptuje albo poprawia pod swój segment rynku. Poziom bez definicji nie
drukuje się w operacie — stąd naturalnie biorą się skale dwustopniowe
(standard: lepsza/dobra), bez żadnej dodatkowej konfiguracji. Definicja
**powierzchni** — jedyna z progiem liczbowym — podpowiada się z **mediany
powierzchni próby porównawczej**, więc próg w dokumencie zgadza się z analizą
rynku tej wyceny, a nie z cudzym operatem.

Wszystko, co zaproponowała aplikacja, podlega znanemu mechanizmowi zaufania:
nieedytowane wagi, skład worka i definicje mają status „**preset — do
weryfikacji**" i blokują zatwierdzenie wyceny, dopóki rzeczoznawca nie
kliknie „Potwierdź cechy i wagi" na stronie operatu (jak przy próbie RCN,
danych ewidencyjnych czy KW). Oceny przedmiotu pozostają — jak dotąd —
uznaniową decyzją rzeczoznawcy.

W gotowym operacie sekcja 12.1 przestaje kłamać dwa razy: znikają zaszyte na
sztywno definicje skali z operatu Kościelnej (dziś każdy wygenerowany operat
dostawał próg „poniżej 65 m²" i „parter gorszy" niezależnie od danych!),
a w miejscu wyciętej deklaracji o współczynnikach r² pojawia się uczciwe
zdanie: wagi przyjęto na podstawie analizy rynku lokalnego oraz wiedzy
i doświadczenia zawodowego rzeczoznawcy (wariant krótki z ADR-006, AC-8).

Pod maską: słownik cech i defaulty żyją jako stała domenowa w kodzie (worek
per typ obiektu — dziś tylko „lokal"; nowy typ = nowy wpis, ADR-008), przy
tworzeniu wyceny kopiują się do formularza i zapisują w niezmiennym
snapshocie `inputs` — zero zmian w bazie, zero zmian w silniku KCS (golden
test 1 044 400 zł nietknięty), zero zmian w workerze. Prowenancję nadaje
serwer, porównując nadesłane wartości z presetem — klient nie może „udawać"
ręcznej edycji.

## Outcome / Definition of Done

Worek cech per typ (lokal), preset wag F-6, skala ocen jako edytowalne
defaulty per wycena. DONE = na produkcji:

1. **Worek zmodyfikowany:** wycena z dodaną cechą z puli (np. rodzaj
   zabudowy) i usuniętą inną (np. pomieszczenia przynależne), wagi Σ=100% →
   potwierdzenie → zatwierdzenie → DOCX: Tabela 3 i §12.2 bez usuniętej
   cechy, definicje skali z formularza w §12.1, proza wag (wariant krótki).
2. **Czyste defaulty:** wycena bez dotykania sekcji cech → blocker „Cechy
   i wagi (preset — do weryfikacji)" → „Potwierdź cechy i wagi" →
   zatwierdzenie → DOCX z defaultowymi definicjami i progiem powierzchni
   z mediany próby.
3. **Regresja golden:** dane Kościelnej przez formularz → WR 1 044 400 zł
   co do złotówki.
4. **Legacy:** istniejące wyceny prod (write-once `inputs` bez `key`/
   `definitions`) wyświetlają się i renderują bez zmian; zatwierdzone
   operaty (zamrożone bajty) nietknięte.

## Zakres / poza zakresem

**W zakresie:** preset domenowy (`feature-presets.ts`, worek lokalu 6+3
z defaultami definicji), rozszerzenie schematu formularza (`key`,
`definitions`, walidacja puli i duplikatów), UI worka (dodaj/usuń z puli,
akordeon definicji, prefill progu powierzchni z mediany), źródło `preset`
w kernelu + scalar `featureDefs` + serwerowe nadawanie prowenancji przez
porównanie z presetem, blocker F-4 + akcja `confirmFeatures` + karta na
stronie operatu, model dokumentu `{#skala_ocen}` + filtr wagi 0, regeneracja
szablonu przez `build_template.py` (pętla §12.1 + proza wag + anty-literały),
**F-6 w CI**, rozszerzenie F-12, testy RTL od początku.

**Poza zakresem (świadomie):** auto-oceny transakcji porównawczych
(FR-FEAT-05, tabela §11 — poza outcome roadmapy, kandydat NEXT przy UI
wizard); ekstrapolacja poza skalę (NI pkt 6.4 — YAGNI → LATER); edytor
liczby poziomów 2/4 z makiety (wymaga decyzji o mapowaniu Ui pośrednich);
ekran ustawień admina (FR-10/E9) i globalna konfiguracja (open question M
zostaje otwarty — preset zmienia się commitem); worki dla działki/domu
(ADR-008: nowy wpis w const); AI-vision ocena standardu ze zdjęć („nice to
have" z warsztatu); tworzenie własnych cech spoza puli (brakującą cechę
dodajemy commitem — lista Anety otwarta, ale przez nas); twarde sprzężenie
ocen z definicjami (ocena „gorsza" przy pustej definicji poziomu nie
blokuje — miękkie ostrzeżenie to backlog).

## Architektura

```
domain/feature-presets.ts (const, worek per typ — dziś "lokal")
        │  kopiowanie defaultów przy otwarciu formularza
        ▼
formularz (client) ── dodaj/usuń z puli, wagi, oceny, definicje,
        │             prefill progu powierzchni z mediany próby
        ▼ submit
server action (zod: klucze ⊆ pula, bez duplikatów, Σ=100%)
        │  prowenancja SERWEROWO: nadesłane == oczekiwane z presetu
        │  (wagi+worek / definicje, z medianą liczoną z comparables)
        │  → preset/to_verify; różne → rzeczoznawca/confirmed
        ▼
inputs jsonb (write-once; features[] + key + definitions — silnik
        │     czyta {name, weight, rating}, nadmiar ignoruje)
        ▼
strona operatu: karta „Cechy i wagi" + „Potwierdź cechy i wagi"
        │            → F-4 (approvalGate, blocker featureDefs/weights)
        ▼
buildDocumentModel: filtr weight>0 → {#cechy}/{#opis_*} (bez zmian)
                    + {#skala_ocen} (cecha × niepuste poziomy)
szablon: build_template.py — pętla §12.1 + proza wag (literał stały)
```

Silnik `computeKcs` **nietknięty** (F-1/F-2/F-3 bez zmian). Worker
nietknięty (F-11 bez ryzyka). Zero DDL — wszystko w `inputs`.

## Model danych

**Preset** (`apps/web/src/domain/feature-presets.ts`):

```ts
type FeatureLevel = "gorsza" | "przecietna" | "lepsza";
type FeaturePresetEntry = {
  key: string; // stabilny slug bez diakrytyków, np. "standard-wykonczenia"
  name: string; // do silnika i operatu, np. "standard wykończenia"
  defaultWeightPct: number; // 40/30/10/10/4/6; wyjątkowe: 0
  kind: "basic" | "exceptional";
  defaultDefinitions: Partial<Record<FeatureLevel, string>>;
};
export const FEATURE_PRESETS: Record<"lokal", FeaturePresetEntry[]>;
```

Worek lokalu (nazwy i skład = kanoniczna lista Anety z `cechy_lokali.md`):

| key                         | name                      | waga | kind        | defaulty definicji (poziomy)                                                         |
| --------------------------- | ------------------------- | ---- | ----------- | ------------------------------------------------------------------------------------ |
| `standard-wykonczenia`      | standard wykończenia      | 40   | basic       | lepsza / przeciętna / gorsza (3)                                                     |
| `polozenie-na-pietrze`      | położenie na piętrze      | 30   | basic       | lepsza „4. piętro i powyżej" / przeciętna „piętra pośrednie (1–3)" / gorsza „parter" |
| `lokalizacja`               | lokalizacja               | 10   | basic       | lepsza / przeciętna (2)                                                              |
| `powierzchnia-uzytkowa`     | powierzchnia użytkowa     | 10   | basic       | lepsza „poniżej {próg} m²" / gorsza „od {próg} m²" (2, próg dynamiczny)              |
| `pomieszczenia-przynalezne` | pomieszczenia przynależne | 4    | basic       | lepsza „jest" / gorsza „brak" (binarna)                                              |
| `dodatkowe`                 | dodatkowe                 | 6    | basic       | lepsza „jest (ogródek / miejsce postojowe / komórka)" / gorsza „brak" (binarna)      |
| `funkcjonalnosc-lokalu`     | funkcjonalność lokalu     | 0    | exceptional | lepsza / gorsza (2)                                                                  |
| `liczba-izb`                | liczba izb                | 0    | exceptional | lepsza / gorsza (2)                                                                  |
| `rodzaj-zabudowy`           | rodzaj zabudowy budynku   | 0    | exceptional | lepsza / gorsza (2)                                                                  |

Pełne brzmienia defaultów definicji powstają w tasku z wzorców Kościelna
(§ standard, piętro, lokalizacja) i Gościejewko §9.1 — `confidence:
hypothesis`, weryfikacja z Anetą przy testach aplikacji (decyzja usera
2026-07-15). Model „per wycena, edytowalne" = `confirmed`.

**Formularz/snapshot** — `featureSchema` rozszerzony:

```jsonc
"features": [{
  "key": "standard-wykonczenia",        // z puli (walidacja: enum 9 kluczy, bez duplikatów)
  "name": "standard wykończenia",
  "weightPct": 40,                       // w snapshotcie: weight (ułamek), jak dziś
  "rating": "przecietna",
  "definitions": {                       // pola opcjonalne; puste → poziom nie drukuje się
    "lepsza": "…", "przecietna": "…", "gorsza": "…"
  }
}]
```

`DEFAULT_FEATURES` przestaje być literałem — jest wyprowadzane z
`FEATURE_PRESETS.lokal` (basic, waga > 0). F-6 przypina wartości (40/30/10/
10/4/6 + nazwy), więc golden-era formularz jest odtworzony co do bajta.

**Legacy:** stare snapshoty bez `key`/`definitions` — odczyt toleruje brak
(pola opcjonalne), strona operatu i dokument działają jak dziś (sekcja
definicji = uczciwa cisza, wzorzec Slice 6). Formularz wyłącznie **tworzy**
wyceny (routes: `new` + `[id]` detail — edycji szkiców nie ma), więc legacy
kształt nigdy nie wraca do formularza — zero migracji w UI.

## Prowenancja / F-4

- Kernel `@wyceny/shared`: **nowe źródło `preset`** w zamkniętym enumie.
- `InputsProvenance`: istniejące `weights`, `ratings` + **nowy scalar
  `featureDefs`** (etykieta „Definicje skali ocen").
- Nadawanie **serwerowe** (`assign-provenance` przy create/update):
  - `weights`: nadesłany worek (zbiór kluczy) i wagi **równe defaultom
    presetu** → `preset/to_verify`; inaczej → `rzeczoznawca/confirmed`.
  - `featureDefs`: nadesłane definicje równe **oczekiwanym z presetu**
    (statyczne teksty; dla powierzchni serwer odtwarza tekst z progiem =
    mediana powierzchni z nadesłanych `comparables`, zaokrąglona half-up do
    pełnych m²) → `preset/to_verify`; inaczej → `rzeczoznawca/confirmed`.
  - `ratings`: bez zmian — `rzeczoznawca/confirmed` (ocena przedmiotu to
    zawsze decyzja człowieka).
- `approvalGate`: blockery dla `weights`/`featureDefs` w statusie
  `to_verify` (etykiety PL). Legacy `confirmed` → zero nowych blockerów.
- **`confirmFeatures`** (server action, owner-only) — byte-mirror
  `confirmSample`/`confirmSubject`: ustawia `weights` + `featureDefs` na
  `confirmed`. Karta „Cechy i wagi" na stronie operatu: badge prowenancji +
  przycisk „Potwierdź cechy i wagi" (znika po potwierdzeniu).

## UX (formularz)

- Sekcja „Cechy i wagi": wiersze aktywnych cech jak dziś (waga %, oceny
  toggle) + przycisk **„Usuń"** per wiersz (cecha wraca do puli; zod
  `min(1)` pilnuje niepustego worka) + **„Dodaj cechę"** (dropdown
  z nieaktywnych wpisów puli; dodana wchodzi z wagą 0 i defaultami
  definicji — user ustawia wagę, Σ=100% pilnuje reszty).
- Per cecha rozwijany panel „Definicje skali ocen" (Collapsible/`<details>`):
  3 pola tekstowe (gorsza/przeciętna/lepsza) z defaultami; hint „puste pole
  = poziom nie pojawia się w operacie".
- **Prefill progu powierzchni:** dopóki definicje powierzchni są
  nieedytowane, teksty przeliczają się z mediany powierzchni próby przy
  każdej zmianie próby (wzorzec śledzenia „seeded" ze Slice 6); pierwsza
  ręczna edycja zamraża teksty użytkownika.
- `useFieldArray` dostaje `append`/`remove`; testy komponentowe RTL
  (per-plik pragma `// @vitest-environment jsdom`) od pierwszego taska UI.

## Sekcja dokumentu (szablon + model)

- `buildDocumentModel`:
  - istniejące `{#cechy}` (Tabela 3) i `{#opis_cmin}`/`{#opis_cmax}`/
    `{#opis_przedmiot}` (§12.2) — bez zmian strukturalnych, ale zasilane po
    **filtrze `weight > 0`** (pancerz obronny — cecha z wagą 0, gdyby
    została w snapshotcie, nie drukuje się nigdzie);
  - nowa pętla **`{#skala_ocen}`**: `[{ cecha, poziomy: [{ poziom, def }] }]`
    — tylko cechy aktywne, tylko poziomy z niepustą definicją; kolejność
    poziomów lepsza → przeciętna → gorsza; etykiety z diakrytykami;
  - legacy `inputs` bez definicji → `skala_ocen = []` → blok nie renderuje
    się (uczciwa cisza; zostaje istniejące neutralne zdanie „Na potrzeby
    obliczeń wykorzystano parametry liczbowe…").
- `build_template.py` (wiki-repo `tools/spike/2026-07-15-template-koscielna/`
  — **jedyne źródło regeneracji szablonu**, nigdy ręczna edycja .docx):
  - nowy etap: literały definicji skali Kościelnej w §12.1 → pętla
    `{#skala_ocen}` (kotwiczenie na tekstach źródłowych, `check(...)` jak
    dotychczasowe etapy);
  - wstawienie **stałego zdania prozy wag** (wariant krótki ADR-006):
    „Wagi cech rynkowych przyjęto na podstawie analizy rynku lokalnego oraz
    wiedzy i doświadczenia zawodowego rzeczoznawcy majątkowego,
    odzwierciedlając wpływ poszczególnych atrybutów na jednostkowe ceny
    transakcyjne nieruchomości podobnych." — literał szablonu, nie tag;
  - zmiany w wiki-repo zostają **nieskommitowane** — jadą z PR-em S6 wiki
    (konwencja Slice 5/6); edycje z niewidocznymi znakami przez Python I/O
    (lekcja NBSP).

## Testy / fitness functions (CI od pierwszego taska)

- **F-6 (nowy, `f6-feature-preset.test.ts`):** Σ wag basic = 100 dokładnie;
  pula = 9 kanonicznych kluczy (snapshot listy Anety); wagi i nazwy 6
  podstawowych = dotychczasowe literały formularza (40/30/10/10/4/6);
  `DEFAULT_FEATURES` ≡ pochodna presetu; defaulty definicji niepuste dla
  zadeklarowanych poziomów.
- **F-1/F-2/F-3:** bez zmian — fixture Kościelnej i 1 044 400 zł nietknięte
  (silnik ignoruje nowe pola — test to przypina: `computeKcs` na wejściu
  z `key`/`definitions` daje identyczny wynik).
- **F-12 (rozszerzenie tria):** wymagane tagi `{#skala_ocen}`/`{/skala_ocen}`;
  obecność frazy prozy wag („przyjęto na podstawie analizy rynku
  lokalnego"); **anty-literały** definicji Kościelnej w bajtach szablonu
  (np. „poniżej 65 m2", „4 piętro i powyżej"); zakaz „korelacji" bez zmian.
- **Prowenancja:** testy nadawania (defaulty → preset/to_verify; edycja wagi
  / worka / definicji → rzeczoznawca/confirmed; mediana-prefill traktowany
  jako preset); test tamperingu (klient nie wymusi confirmed); blocker
  w `approvalGate`; `confirmFeatures` owner-only + przejście statusów.
- **Formularz:** zod (klucze spoza puli, duplikaty, Σ≠100, pusty worek);
  RTL (dodaj/usuń, akordeon, prefill mediany i jego zamrożenie po edycji).
- **Dokument:** model (`skala_ocen` mapping, filtr wagi 0, legacy cisza);
  render-completeness na realnym szablonie (F-12 noga 3). Fixture'y
  wyłącznie syntetyczne (**F-9**).

## Decyzje z brainstormu (2026-07-18, user)

1. **Model presetu:** stała domenowa w kodzie → kopia do wyceny; zero DDL;
   ekran ustawień/globalna konfiguracja = LATER (open question M otwarty).
2. **Worek:** zamknięta pula 9 (6 basic + 3 exceptional), dodaj/usuń z puli;
   bez tworzenia własnych cech.
3. **Skala:** 3 poziomy silnika nietknięte; edytowalne definicje słowne per
   cecha; puste poziomy nie drukują się (naturalne skale 2-stopniowe);
   edytor liczby poziomów = LATER.
4. **Próg powierzchni:** podpowiedź z mediany próby (serwer weryfikuje przy
   nadawaniu prowenancji).
5. **Prowenancja:** nowe źródło `preset` + scalar `featureDefs` + blocker
   F-4 + `confirmFeatures`; oceny zostają `rzeczoznawca/confirmed`.
6. **Proza §12.1:** wariant krótki ADR-006 (DRAFT — potwierdzenie Anety przy
   testach aplikacji).

## Ryzyka / zależności

- **Golden pod ochroną:** największe ryzyko slice'a to regresja F-1 przy
  refaktorze `DEFAULT_FEATURES`/schematu — F-6 + istniejący golden łapią to
  w CI od pierwszego taska.
- **Szablon:** każda zmiana .docx wyłącznie przez `build_template.py`;
  anty-literały pilnują, żeby definicje Kościelnej nie wróciły; diff
  wiki-repo jedzie nieskommitowany do PR-a S6 (prowenancja szablonu).
- **Serwerowe porównanie z presetem** musi być deterministyczne (trim,
  normalizacja białych znaków) — inaczej fałszywe `rzeczoznawca` przy
  niezmienionych defaultach.
- **Legacy prod:** write-once `inputs` — żadnych backfilli; odczyt
  toleruje brak nowych pól (testy na obu kształtach).
- Ekran „nowa wycena" rośnie — bez zmiany architektury formularza (jeden
  client component jak dziś); wizard 7 kroków to osobny slice (NEXT).

## Podział na taski (orientacyjny, do planu)

1. Kernel + preset: źródło `preset` w `@wyceny/shared`, `feature-presets.ts`
   z defaultami definicji, **F-6** (RED→GREEN), derywacja `DEFAULT_FEATURES`.
2. Schemat formularza: `key`/`definitions`, walidacja puli/duplikatów,
   test silnik-ignoruje-nadmiar.
3. UI worka: dodaj/usuń z puli + RTL.
4. UI definicji: akordeon + prefill mediany (seeded) + RTL.
5. Prowenancja: `featureDefs`, serwerowe porównanie z presetem,
   `approvalGate`, testy tamperingu.
6. `confirmFeatures` + karta „Cechy i wagi" na stronie operatu + testy.
7. Model dokumentu: `skala_ocen`, filtr wagi 0, legacy cisza + testy.
8. Szablon: `build_template.py` (pętla §12.1 + proza wag) + rozszerzenie
   F-12 — para z taskiem 7 (jeden push, F-12 RED między nimi, wzorzec
   Slice 5 T7+T8).

## Referencje

- Roadmapa: wiki `wiki/roadmap.md` (NOW 2026-07-18); ADR-006 (preset, proza
  §12.1 — załącznik z wariantami); `wiki/topics/domain/cechy-porownawcze-lokali.md`
  (kanoniczna lista 6+3, kryteria skali — wzorzec Gościejewko §9.1, decyzja
  2026-07-15); warsztat 2026-06-16 (`raw/meetings/Warsztat-Aplikacja-do-wycen-…`)
  — „pancerz obronny", „nie zawsze jest pięć cech", edycja per operat;
  PRD FR-4/AC-8/NFR-8; makieta v3-r4 (mechanika worka).
- Kod zastany: `valuation-form-schema.ts` (DEFAULT_FEATURES:158),
  `domain/kcs.ts` (Feature:46), `domain/provenance.ts`,
  `lib/assign-provenance.ts`, `domain/document-model.ts` (cechy:317,
  opisy:327), `tests/f12-template-integrity.test.ts`,
  wiki-repo `tools/spike/2026-07-15-template-koscielna/build_template.py`.
