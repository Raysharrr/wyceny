# S1 — lokalna regresja w przeglądarce

2026-09-13. Weryfikowany head `cade8357423d053c5c635e629b38e119c4f6dac1`, PR41, gałąź `feature/pairwise-contracts`. To test po zmianach S1, odrębny od wcześniejszego baseline i logowania na integracji.

## Środowisko

- Web localhost:3016 i worker127.0.0.1:8016 uruchomione bezpośrednio z worktree `pairwise-contracts`; realny LibreOffice i storage PostgreSQL.
- Izolowana baza koordynatora: `wyceny-pairwise-test`, port5544. Konto testowe Zenon; dwie syntetyczne wyceny utworzone przez formularz. Bez danych rzeczywistych klientów, stagingu i produkcji.
- Wyłączone live autofetch, mapy, upload zdjęć i generator prozy. Nie są objęte tym lokalnym scenariuszem; ekran Opisy używa istniejącego trybu szablonu. PP i jawny wybór metody nie są jeszcze podłączone w S1.

## Wyniki

| Scenariusz                                                                                    | Wynik                                                                                |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Własność: utworzenie przedmiotu, KW testowa, oględziny, zapis12 ręcznych transakcji           | PASS                                                                                 |
| Własność: cechy domyślne, zmiana standardu na lepszy, kalkulacja                              | PASS: Cśr9550, ΣUi1,023, WR488500                                                    |
| Własność: ponowne otwarcie w Chrome, realny podgląd PDF, zatwierdzenie                        | PASS: stan Zatwierdzony, PDF/DOCX, kwota słownie                                     |
| Spółdzielcze: utworzenie bezKW, właściwa etykieta rejestru biura, zapis12 ręcznych transakcji | PASS                                                                                 |
| Spółdzielcze: potwierdzenie477500, edycja oceny, unieważnienie wyniku i reload                | PASS: komunikat ponownego potwierdzenia zachowany, stara kwota nie jest zatwierdzona |
| Spółdzielcze: ponowne potwierdzenie488500, realny podgląd PDF, zatwierdzenie bezKW            | PASS                                                                                 |
| Oba wydane PDF: parsowana kwota488500 i prawidłowy rodzaj prawa                               | PASS                                                                                 |

Każdy zapis wykonano w UI przez CUA. Po UI odczytano bazę i wydane PDF jako dodatkowy dowód utrwalenia; nie podstawiano gotowych wycen do bazy. Dokument własności ma360591 bajtów, spółdzielczy352918 bajtów. Jedna próba eksportu podglądu po approval trafiła już na usunięty tymczasowy plik; sprawdzono zamiast niego właściwy wydany dokument.

## Dowody i ograniczenia

Lokalnie `/tmp/pairwise-s1-browser/`: `ownership-calculation.txt/png`, `ownership-approved.txt/png`, `coop-source.txt`, `coop-invalidated-after-reload.txt/png`, `coop-approved.txt/png`, `ownership-pdf-visible-chrome.png`, `coop-pdf-visible-chrome.png`, oba `*-issued.pdf/txt` oraz `pdf-evidence.json` z SHA-256. Logi stacka: `/tmp/pairwise-s1-web.log`, `/tmp/pairwise-s1-worker.log`. Artefakty pozostają poza gitem, ponieważ szablon zawiera dane biura.

Przeglądarka Codex pokazała pusty czytnik PDF mimo poprawnej odpowiedzi; ten sam plik obejrzano w osadzonym czytniku Chrome — dokument widoczny i właściwy wariant prawa. Nie uznano pustego czytnika za PASS wyglądu. Zapisane są zrzuty/DOM i asercje podczas sesji CUA, nie Playwright trace.

CI na tym samym head:12 browser PASS/2 opt-in skip,24,8s samego testu; całe zadanie E2E2m54s. Pominięte liveRCN i spółdzielcze approval wymagające specjalnych flag. Lokalny scenariusz powyżej uzupełnia approval spółdzielcze na ręcznych danych. CI log `/tmp/pairwise-s1-final-ci.log`. Bez deklaracji manualnego testu importu SM/liveRCN, prozy AI, map, uploadu zdjęć ani końcowego podpisu; podpis/historia mają testy dotychczasowe, a pełną weryfikację po zmianach renderowania wykonują S4/S5.
