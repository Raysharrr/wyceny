# Slice 3d „Ulica z eksportu RCN GEOPOZ” — raport cel → dowód

Gałąź `feat/proba-v3-slice3d-ulice`, weryfikacja 2026-08-22 na **buildzie produkcyjnym**
(`pnpm build && pnpm start -p 3004`), z żywym workerem (uvicorn :8010, prawdziwy eksport
GEOPOZ) i lokalnym Postgresem. Ścieżka przechodzona w całości przez UI: logowanie → krok 1
(adres z podpowiedzi UUG, dane EGiB zaczytane) → krok 3 → „Pobierz próbę z RCN”.

## DoD

| cel                                                     | dowód                                                            | wynik                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Heweliusza 3/43: **≥10/12 wierszy z nazwą ulicy**       | pomiar w tabeli kroku 3, kolumna liczona po nagłówku             | **12/12 w próbie, 36/36 alternatyw** (`tabela-1280.png`)                     |
| Transakcja spoza Poznania → kreska + odznaka, bez błędu | wymuszony stan bez indeksu (niżej)                               | **0/12 z ulicą, HTTP 200**, dymek z instrukcją (`06-kreska-bez-indeksu.png`) |
| F-12: numer budynku nie trafia do dokumentu             | render prawdziwego szablonu na propozycji z numerem „33A”        | test `f12-document-sections`; w PDF numeru nie ma (`11-operat-gmina.png`)    |
| F-12: odcisk szablonu                                   | `TEMPLATE_SHA256` zmieniony w tym samym commicie co `.docx`      | `f12-template-integrity` zielony                                             |
| F-10 / F-13 / F-14                                      | depcruise; zdarzenia z licznikami; siedem zamrożonych snapshotów | wszystkie zielone                                                            |
| Pomoc                                                   | `krok-3-proba`, `operat-i-niezmiennosc`, `dobor-proby-rcn`       | zaktualizowane (T6)                                                          |

Bramki: worker **227/227**, web **134 pliki / 1432 testy**, typecheck 0 błędów, depcruise
czysty, `pnpm build` przechodzi.

## Krok 3 — szerokość tabeli

Tabela ma jedenaście kolumn: `W próbie | ✓ | Fasada | Data | Ulica | Obręb | Odległość |
Pow. (m²) | Cena (zł/m²) | Piętro | Odznaki`. Sprawdzone w obu szerokościach, mierząc
`scrollWidth > innerWidth`:

| szerokość | wiersze z ulicą | poziomy pasek przewijania | zrzut             |
| --------- | --------------- | ------------------------- | ----------------- |
| 1280 px   | 12/12           | **nie**                   | `tabela-1280.png` |
| 1440 px   | 12/12           | **nie**                   | `tabela-1440.png` |

Panel boczny pokazuje adres z numerem obok panoramy (`panel-adres.png`): „Adres —
ul. Heweliusza 11”.

## Operat — Tabela 1

Układ z operatu wzorcowego: `Data transakcji | Miasto | Ulica | Pow. uż. [m2] | Cena
transakcyjna [zł/m2]`. Wyrenderowane przez prawdziwy szablon i przepuszczone przez
LibreOffice workera (`11-operat-gmina.png`, strona 9):

| Data    | Miasto         | Ulica                               |
| ------- | -------------- | ----------------------------------- |
| 2026-05 | Poznań         | Kościelna                           |
| 2026-05 | Poznań         | Andrzeja i Władysława Niegolewskich |
| 2026-05 | **gm. 302104** | —                                   |
| 2026-05 | Poznań         | —                                   |

Szerokości kolumn zamienione w tym samym skrypcie, który podmienia nagłówki: „Ulica”
dostała 4,6 cm (po „Obrębie”), „Miasto” 2,3 cm. Bez tego najdłuższe nazwy zawijałyby się
na cztery linie; teraz na dwie. Suma szerokości tabeli bez zmian.

**Do decyzji użytkownika przy odbiorze:** wiersz spoza Poznania ma w kolumnie „Miasto”
**kod gminy** („gm. 302104”), bo nazwy gminy nie mamy, a kreska w obu kolumnach byłaby
regresem wobec Slice 3 (tam tę informację niosła kolumna „Obręb”). Nagłówek mówi „Miasto”,
a wartość miastem nie jest — zrzut pokazuje, jak to wygląda w dokumencie.

## Czego NIE zaobserwowano w warunkach produkcyjnych

Uczciwe rozgraniczenie, o które prosił team-lead — **dwie z czterech treści odznak nie
wystąpiły na żywych danych** i są pokryte wyłącznie testem jednostkowym:

- **„spoza Poznania”** — transakcje z gmin ościennych są w puli (79 przy Heweliusza,
  200 przy Sielawach), ale ranking ADR-015 nie wciąga ich do propozycji ani alternatyw.
  Sprawdzone przy 500 m i po rozszerzeniu do 3000 m, na dwóch adresach: **48/48 i 64/64
  z ulicą, zero kresek**;
- **„nowsza niż eksport”** — w całym pomiarze jeden taki rekord w puli 25 000, żaden nie
  trafił do próby (usługa WFS GUGiK jest opóźniona bardziej niż miesięczny eksport).

Obie zostają w kodzie: granica pokrycia jest realna, a dane się zmienią. Ale nikt ich
jeszcze nie widział na ekranie poza testem.

## Jak odtworzyć stan „worker bez indeksu”

Nieoczywiste, a potrzebne przy każdej zmianie w tym obszarze: uruchom workera z katalogiem
cache, do którego **nie ma prawa zapisu** — budowa indeksu przerywa się, `status` idzie na
`unavailable`, a aplikacja zachowuje się jak przy pierwszym uruchomieniu:

```bash
STREET_INDEX_CACHE_DIR=/System/nie-da-sie-zapisac uvicorn app.main:app --port 8010
```

Efekt: `street_index_failed` w logu, **healthcheck dalej 200**, `/sample-proposal` zwraca
pulę bez ulic ze `streetIndex.status`, a krok 3 pokazuje kreski z dymkiem „Adresy się
wczytują — pobierz próbę z rejestru ponownie za chwilę”. Zero błędów po stronie użytkownika.

## Sprostowanie własnego pomiaru

Pierwsze przebiegi raportowały „64/64 z ulicą” — liczyły kolumnę **Data**, nie **Ulica**
(checkbox i ✓ przesuwają numerację komórek). Wszystkie liczby w tym raporcie pochodzą
z poprawionego pomiaru, który znajduje kolumnę po nagłówku.

## Checklista dla użytkownika

1. Krok 3 na Heweliusza 3: kolumna **Ulica** z numerem przy każdej z 12 propozycji.
2. Panel boczny: pole **Adres** obok panoramy.
3. Operat (PDF): Tabela 1 ma `Data | Miasto | Ulica | Pow. | Cena`, **bez numeru budynku**,
   bez obrębu i odległości.
4. Wiersz spoza Poznania: „gm. 302104” i kreska — **czy tak ma zostać?**
5. „al. Aleje Karola Marcinkowskiego” — jedyna nazwa ze zdublowanym prefiksem w rejestrze;
   drukujemy wiernie. **Zostawiamy?**
