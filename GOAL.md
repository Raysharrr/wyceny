# GOAL: Podpowiedzi adresu z UUG (krok 1 kreatora wyceny)

Pełny projekt: `docs/superpowers/specs/2026-08-20-podpowiedzi-adresu-design.md` (ten sam branch).
Spec jest źródłem prawdy — GOAL.md to jego operacyjna kondensacja. Konflikt → wygrywa spec.

## Desire

Pole „Adres" w kroku 1 (`apps/web/src/app/valuations/new/subject-form.tsx`, pole `address`)
podpowiada w trakcie pisania ulice z państwowego rejestru PRG (geokoder UUG GUGiK), przez nowy
endpoint workera `POST /address-suggest`. Wybór podpowiedzi (mysz albo ↑/↓/Enter/Escape)
wstawia kanoniczną formę `Miasto, Ulica`; numer budynku użytkowniczka dopisuje sama. Pozycje z
`teryt` spoza `3064*` mają dopisek „poza pokryciem MVP". Wolny wpis i dzisiejszy autofetch
on-blur (`onAddressBlur`) działają bez zmian. Awaria UUG = brak podpowiedzi, nigdy błąd
formularza. Motywacja: incydent `3d23717d` — naturalny format adresu (kod pocztowy) wywracał
trzy endpointy; podpowiedzi eliminują całą klasę „wpisałam dobrze, aplikacja nie rozumie".

## Quality bar

- TDD: test RED przed implementacją, per warstwa. Worker: `tests/test_address_suggest.py`
  (happy street/address, pusto, nie-JSON „Blad zapytania.", wyjątek → **200 z pustą listą** +
  log `address_suggest_failed`, limit 8, `inCoverage` dla teryt spoza 3064). Web: kontraktowy
  `suggest-contract.test.ts` (stub fetch, timeout → `[]`), akcyjny
  `get-address-suggestions-action.test.ts`, RTL `rtl-address-suggest.test.tsx` (fake timers na
  debounce 300 ms, wybór klawiaturą, `NEXT_PUBLIC_ADDRESS_SUGGEST=off` ⇒ zero fetchy).
- Dostępność: ARIA combobox (`role="combobox"`, `aria-expanded/-controls/-activedescendant`,
  lista `role="listbox"`/`role="option"`), pełna obsługa klawiatury.
- Fitness functions: **F-1 golden 1 044 400 zł NIETYKALNE** (zero kontaktu z silnikiem);
  F-9 (fixture'y syntetyczne, zero PESEL-podobnych ciągów); F-10 (`pnpm depcruise` — port
  czysty); F-11 (worker nigdy nie zwraca WR); F-13 (adres/fraza zapytania NIGDY w logach —
  allowlista `apps/web/src/lib/log.ts`; logujemy tylko `count/status/ms/traceId`; żadnych
  nowych wyjątków `no-console`).
- UI copy po polsku z pełnymi diakrytykami; kod/identyfikatory po angielsku.
- Hooki przechodzą bez obejść: prettier (pre-commit), commitlint (commit-msg), ruff w workerze.
- CI zielone na PR (`.github/workflows/ci.yml` — turbo lint/typecheck/test/build, pytest, e2e).

## Tools + Discovery

- **Wzorce do skopiowania (nie wymyślaj od zera):**
  - server action: `apps/web/src/app/actions/get-subject-data.ts` (gate sesji → zod →
    `withTrace` → `recordEvent`/`recordFailure`),
  - adapter: `apps/web/src/adapters/subject-http.ts` + timeout wzorem
    `apps/web/src/adapters/maps-http.ts` (`AbortSignal.timeout(5_000)`),
  - port: `apps/web/src/ports/subject.ts` (czysty interfejs, zero importów),
  - rejestracja: `apps/web/src/app/valuations/_deps.ts` (jeden eksport),
  - anty-race: idiom `fetchSeq` z `subject-form.tsx:127-138` (licznik w `useRef`),
  - escape-hatch: wzór `NEXT_PUBLIC_SUBJECT_AUTOFETCH === "off"` (`subject-form.tsx:221-228`),
  - worker: modele Pydantic inline nad handlerem w `apps/worker/app/main.py` (wzór
    `SubjectProposal*`, linie ~172-239), normalizacja `normalize_uug_address` i bramka
    `is_poznan` w `apps/worker/app/subject.py`, `GEOKODER_URL` tamże,
  - testy workera: `apps/worker/tests/test_subject_proposal.py` (TestClient + monkeypatch
    granicy I/O, fixture `happy_io`),
  - RTL: `apps/web/tests/rtl-subject-form.test.tsx` (mock next/navigation, shim
    ResizeObserver już w setupie).
- **Kształt odpowiedzi UUG** przypięty live: wiki-repo
  `~/Development/wyceny/tools/spike/2026-08-20-uug-podpowiedzi/results.json` (`results` to
  dict `"1".."N"` z `city/street/number/teryt/accuracy`; typy `street`/`address` mapujemy,
  `city` pomijamy). Możesz dopytać UUG na żywo: `curl
'https://services.gugik.gov.pl/uug/?request=GetAddress&address=Pozna%C5%84%2C%20Siel'`.
- **Pomoc**: treść `apps/web/src/content/pomoc/jak-korzystac/krok-1-przedmiot.mdx` (sekcja o
  adresie, l. ~18 i ~61), rejestr `apps/web/src/content/pomoc/manifest.ts` (slug istnieje —
  tylko aktualizacja treści), testy `help-manifest/help-links/help-search`.
- Komendy: root `pnpm install`; web `pnpm --filter web test` / `pnpm turbo lint typecheck test
build`; worker `cd apps/worker && uv run pytest -q && uv run ruff check . && uv run ruff
format --check .`.

## Creative Freedom

Twoje decyzje: wewnętrzna struktura komponentu `address-suggest-input.tsx`, dokładny wygląd
listy (w ramach tokenów shadcn/istniejących klas), nazwy pomocnicze, podział na funkcje,
treść mikro-copy pozycji „poza pokryciem MVP", kolejność implementacji warstw.
NIE-negocjowalne: **zero nowych zależności** (w repo nie ma cmdk/Command/Popover — ręczny
listbox na istniejącym `<Input>`), endpoint POST (konwencja workera, CORS `POST`-only),
kontrakt „awaria → pusta lista z 200", brak zmian w autofetch on-blur i w silniku wyceny,
brak adresu w logach, montaż przez `Controller` pola `address` działający w obu punktach
(create `new/page.tsx:23`, edit `[id]/page.tsx:94`).

## Verification Loop

1. Worker: `uv run pytest -q` + ruff — wszystkie testy zielone, nowe najpierw RED.
2. Web: `pnpm --filter web test` (kontrakt/akcja/RTL z fake timers), potem pełne
   `pnpm turbo lint typecheck test build`.
3. Żywy dowód endpointu: uruchom worker lokalnie (`uv run uvicorn app.main:app`) i `curl -X
POST localhost:8000/address-suggest -d '{"query":"Poznań, Siel"}' -H 'Content-Type:
application/json'` — oczekuj listy z „Sielawy" i `inCoverage: true`.
4. Żywy dowód UI: `pnpm dev`, wpisz „Siel" w polu adresu kroku 1 — lista pod polem, wybór
   Enterem wstawia `Poznań, Sielawy`, dopisanie ` 21F` + blur odpala istniejący autofetch ✓.
5. Sprawdź `NEXT_PUBLIC_ADDRESS_SUGGEST=off` ⇒ zero requestów (network tab / RTL).
6. Grep sanity F-13: żadne nowe `log.*` nie niesie `query`/`address`.
7. Pętla: każda czerwień → napraw → pełny przebieg od nowa. Koniec dopiero, gdy 1-6 zielone.

## Delivery

- Branch: `feat/podpowiedzi-adresu` (istnieje, spec już na nim — commit `73050f3`).
- Commity per logiczny krok (konwencja repo: `feat(web): ...` / `feat(worker): ...`, opisowe
  polskie komunikaty bez polskich znaków w subject — wzór historii repo; **bez atrybucji AI**).
- Push na origin po każdym kroku; na końcu PR do `main` (wzór opisu: PR #15/#16 — kontekst
  incydentu 3d23717d, sekcje Kontekst/Zmiana/Testy). **NIE merguj** — merge i deploy są
  human-gated; zgłoś gotowość.
- Po merge (poza zakresem tego GOAL): aktualizacja wiki (log/timeline/roadmapa NOW→DONE) wg
  build-slice S6.

## Anti-goals

- Podpowiedzi numerów domów (UUG „only exact numbers" — spike to wykluczył), fuzzy matching,
  transliteracja bez diakrytyków, cache, podpowiedzi samych miast.
- Wymuszanie wyboru z listy (wolny wpis zostaje — decyzja usera).
- Dotykanie `computeKcs`/silnika, przepływów `sample`/`subject`/`map` poza punktem montażu,
  konfiguracji Vercel/Railway, migracji bazy.
- Nowe zależności npm/pypi. Nowe wyjątki w bramkach CI. Logowanie czegokolwiek, co niesie
  adres.
