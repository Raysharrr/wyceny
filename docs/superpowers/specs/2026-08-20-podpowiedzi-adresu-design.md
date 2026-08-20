# Spec: Podpowiedzi adresu z UUG (krok 1)

> **Aktualizacja 2026-08-20 (wieczór), decyzja usera:** podpowiedzi obejmują wyłącznie zakres pokrycia (TERYT `3064*`, stała `COVERAGE_TERYT_PREFIX` w `apps/worker/app/subject.py`); worker filtruje kandydatów przed obcięciem do 8, pole `inCoverage` i dopisek „Adres spoza Poznania…” zostały usunięte z kontraktu, portu i komponentu. Docelowo adres w kroku 1 wybiera się wyłącznie z listy (ulica z listy + numer walidowany w UUG) — Slice 4 bloku „Próba v3” (wiki: `docs/superpowers/specs/2026-08-20-dobor-proby-v3-design.md`). Fragmenty poniżej o `inCoverage` i dopisku są historyczne.

**Data**: 2026-08-20 · **Status**: do review · **Slice**: roadmapa 🟢 NOW (wiki PR #25)
**Poprzedzają**: incydent `3d23717d` (diagnoza 2026-08-20), hotfixy PR #15 (logowanie przyczyn
w gołych `except`) i PR #16 (`parse_address` wycina kod pocztowy), spike
`tools/spike/2026-08-20-uug-podpowiedzi/` (wiki-repo, ✅ PASS).

## Opis produktowy — co budujemy z perspektywy użytkownika

Dziś pole „Adres" w kroku 1 to zwykłe pole tekstowe. Rzeczoznawczyni wpisuje adres tak, jak ma
go w zleceniu — na przykład `ul. Sielawy 21F/17, 61-619 Poznań` — i dopiero po wyjściu z pola
dowiaduje się, czy aplikacja adres rozumie. Gdy nie rozumie, dostaje komunikat o błędzie i musi
zgadywać, co poprawić: usunąć kod pocztowy? numer lokalu? zmienić kolejność? Incydent z 20
sierpnia pokazał, że jeden nietypowy (a przecież całkowicie naturalny) format potrafił położyć
pobieranie danych przedmiotu, mapy i próbę z RCN naraz.

Po tym slice'ie pole adresu zacznie **podpowiadać w trakcie pisania**. Po wpisaniu co najmniej
trzech liter aplikacja pokaże pod polem listę ulic z państwowego rejestru adresów (PRG, przez
geokoder UUG GUGiK) — np. dla „Siel" zobaczymy „Poznań, Sielawy", „Poznań, Sielska"… Wybranie
podpowiedzi (myszą albo strzałkami i Enterem) wpisuje do pola kanoniczną formę `Miasto, Ulica`,
do której użytkowniczka dopisuje tylko numer budynku. Tak zbudowany adres ma gwarancję, że
geokodery go strawią — znika cała klasa błędów „wpisałam dobrze, aplikacja nie rozumie".

Jeśli podpowiedź dotyczy miejscowości spoza Poznania, przy pozycji pojawi się dopisek
„poza pokryciem MVP" — użytkowniczka dowiaduje się o ograniczeniu **zanim** wpisze cały adres
i kliknie pobieranie, a nie z komunikatu błędu po fakcie. Ręczne wpisywanie działa jak dotąd:
podpowiedzi są pomocą, nie przymusem (decyzja: „sugestie + wolny wpis" — UUG nie zna nowych
inwestycji, nie toleruje literówek ani zapisu bez polskich znaków). Gdy podpowiedzi nie
przychodzą (UUG w awarii, brak sieci), pole zachowuje się jak zwykły input — nic się nie
blokuje. Istniejące zachowanie „po wyjściu z pola aplikacja pobiera dane przedmiotu i pokazuje
✓/ℹ" pozostaje bez zmian i to ono nadal jest ostateczną walidacją pełnego adresu.

**Pod maską**: worker dostaje nowy endpoint `/address-suggest`, który normalizuje częściowy
wpis tą samą funkcją co pobieranie danych przedmiotu (`normalize_uug_address` — po PR #16
odporną na kody pocztowe) i pyta UUG; web dokłada port+adapter+server action wzorem istniejących
propozycji oraz lekki, dostępny listbox pod polem adresu (bez nowych zależności). Zapytania są
debounce'owane (300 ms), a spóźnione odpowiedzi odrzucane licznikiem sekwencji — idiomem już
obecnym w formularzu. Adres nigdy nie trafia do logów (allowlista F-13) — logujemy tylko
liczbę podpowiedzi, status i czas.

## Outcome

Debounced podpowiedzi ulic z UUG na polu adresu w kroku 1 (create **i** edit), z oznaczeniem
pokrycia MVP per pozycja, bez blokowania wolnego wpisu i bez zmiany istniejącej walidacji
on-blur. Błąd/timeout UUG = pusta lista, nigdy błąd formularza.

## Definition of Done

- [ ] Wpisanie ≥3 znaków w pole adresu pokazuje listę podpowiedzi (≤8) w ~kilkaset ms;
      wybór (mysz/klawiatura) wstawia `Miasto, Ulica` i zostawia fokus w polu.
- [ ] Podpowiedź z `teryt` niezaczynającym się od `3064` ma dopisek „poza pokryciem MVP".
- [ ] Awaria UUG (5xx/timeout/nie-JSON) → pusta lista + log po stronie workera; formularz
      działa normalnie.
- [ ] `NEXT_PUBLIC_ADDRESS_SUGGEST=off` wyłącza fetch podpowiedzi (e2e/CI bez sieci — ten sam
      kontrakt co `NEXT_PUBLIC_SUBJECT_AUTOFETCH`).
- [ ] Golden **F-1 = 1 044 400 zł** nietknięty; F-9/F-10/F-11/F-13 zielone.
- [ ] Strona Pomocy `krok-1-przedmiot.mdx` opisuje podpowiedzi (testy help-* zielone).
- [ ] Zero adresu/frazy zapytania w logach web i workera (allowlista `log.ts`, konwencja
      `proposal.*`; worker loguje `count/status/ms/trace_id`).

## Architektura

### Worker (FastAPI) — `POST /address-suggest`

Wszystkie endpointy workera są POST (CORS `allow_methods=["POST"]`) — nowy też.

- `apps/worker/app/subject.py`: nowa funkcja I/O `suggest_addresses(query: str) -> list[dict]`:
  `normalize_uug_address(query)` → UUG `GetAddress` (`_get` z **timeout 5 s**, nie 30 —
  autocomplete nie może wisieć) → `json.loads` → mapowanie `results` na listę
  `{city, street, number|None, teryt}`. Typ `city` w odpowiedzi UUG pomijamy (YAGNI);
  typy `street` i `address` mapujemy. Nie-JSON („Blad zapytania.") / brak `results` → `[]`.
- `apps/worker/app/main.py` (modele inline nad handlerem, wzorem `SubjectProposal*`):
  `AddressSuggestRequest{query: str}` → `AddressSuggestResponse{suggestions: list[AddressSuggestion]}`,
  `AddressSuggestion{label: str, city: str, street: str, number: str|None, teryt: str|None,
inCoverage: bool}` (camelCase jak reszta). `label` = `"{city}, {street}[ {number}]"`.
  `inCoverage = subject.is_poznan(teryt)`. Limit 8 pozycji. `except Exception` →
  `logger.error("address_suggest_failed", err=..., err_type=...)` → **zwróć pustą listę z 200**
  (nie 502 — podpowiedzi to enhancement; kontrakt: sugestie nigdy nie psują formularza).
  Kształt odpowiedzi UUG przypięty live w spike'u (results.json): `results` to dict
  `"1".."N"` z polami `city/street/number/teryt/accuracy`.

### Web — port → adapter → action → UI

- **Port** `apps/web/src/ports/address-suggest.ts` — czysty interfejs (F-10):
  `PortAddressSuggest = { suggest(query: string): Promise<AddressSuggestion[]> }`.
- **Adapter** `apps/web/src/adapters/suggest-http.ts` wzorem `subject-http.ts` +
  `AbortSignal.timeout(5_000)` (precedens: `maps-http.ts`); `!ok` lub wyjątek → `[]`
  (adapter też nie eskaluje — patrz kontrakt wyżej). `traceHeaders()` w nagłówkach.
- **`_deps.ts`**: `export const addressSuggest = httpAddressSuggest(process.env.WORKER_URL ?? …)`.
- **Server action** `apps/web/src/app/actions/get-address-suggestions.ts` wzorem
  `get-subject-data.ts`: gate sesji, zod (`z.string().trim().min(3).max(200)`), `withTrace`,
  `recordEvent({event: "proposal.addressSuggest", meta: {count}})` — **bez frazy zapytania**
  (F-13). Błąd → `recordFailure` + `{suggestions: []}`.
- **UI** `apps/web/src/components/wizard/address-suggest-input.tsx` (`"use client"`):
  opakowanie istniejącego `<Input>` w ARIA combobox (`role="combobox"` +
  `aria-expanded/aria-controls/aria-activedescendant`, lista `role="listbox"` /
  `role="option"`) — **bez nowych zależności** (w repo nie ma `cmdk`/`Command`/`Popover`
  komponentu; repo idzie po prymitywach — ręczny listbox jest mniejszy niż dokładanie
  biblioteki). Klawiatura: ↑/↓/Enter/Escape; klik = wybór; blur zamyka listę (uwaga na
  `onBlur` vs klik w opcję — `onMouseDown` z `preventDefault`). Debounce 300 ms
  (`setTimeout`+`clearTimeout` w efekcie), min. 3 znaki, anty-race licznikiem `useRef`
  (idiom `fetchSeq` z `subject-form.tsx:127-138`), escape-hatch
  `process.env.NEXT_PUBLIC_ADDRESS_SUGGEST === "off"`.
- **Montaż** w `subject-form.tsx` (pole `address`, `Controller`) — komponent przejmuje
  `field`, zachowując istniejący `onBlur` → `onAddressBlur()` (autofetch bez zmian).
  Działa w obu punktach montażu formularza (create `new/page.tsx`, edit `[id]/page.tsx`).

### Poza zakresem (świadomie)

- Podpowiedzi numerów domów (UUG „only exact numbers" — spike), fuzzy/literówki,
  transliteracja bez diakrytyków, cache, podpowiedzi miast, zmiana walidacji on-blur,
  wymuszanie wyboru z listy.

## Odstępstwo od makiety

Makieta v3-r4 nie zawiera autocomplete (krok 1 to „ekran weryfikacji, nie formularz";
adres = pole ręczne `SourceTag RECZNE`, `screens-1.jsx:174`). Slice **świadomie rozszerza**
makietę o interakcję podpowiedzi na istniejącym polu — budujemy z wymagań pisanych
(ui-planning §4), reszta layoutu kroku 1 bez zmian. Porównanie side-by-side na zamknięciu
slice'a (ui-planning §5) ma to odnotować jako „świadome odstępstwo".

## Testy

- **Worker**: `tests/test_address_suggest.py` — monkeypatch granicy I/O wzorem
  `test_subject_proposal.py`: happy (street/address), pusta odpowiedź, nie-JSON,
  wyjątek → 200 z `[]` + log `address_suggest_failed`, limit 8, `inCoverage` dla teryt
  spoza `3064`. Czysty rdzeń mapowania w `test_subject_core.py` (fixture JSON z UUG
  przypięty ze spike'a — syntetyczne adresy, F-9).
- **Web**: kontraktowy `tests/suggest-contract.test.ts` (stub `fetch`, timeout→`[]`),
  akcyjny `get-address-suggestions-action.test.ts`, RTL `rtl-address-suggest.test.tsx`
  (fake timers na debounce, wybór klawiaturą, escape-hatch off = zero fetchy,
  `ResizeObserver` shim już jest w setupie RTL).
- **e2e/CI**: `NEXT_PUBLIC_ADDRESS_SUGGEST=off` w jobie e2e (jak `SUBJECT_AUTOFETCH`);
  smoke przechodzi bez sieci.

## Wpływ na fitness functions

F-1: zero kontaktu z silnikiem — nietknięte. F-9: fixture'y syntetyczne. F-10: nowy port
czysty, adapter importowany tylko z `app/`. F-11: worker zwraca adresy, nigdy WR. F-13:
adres/fraza poza logami (allowlista), nowe zdarzenie `proposal.addressSuggest` z samym
`count`; eslint `no-console` bez nowych wyjątków.
