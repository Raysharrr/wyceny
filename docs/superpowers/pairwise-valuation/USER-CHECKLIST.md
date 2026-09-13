# Odbiór użytkownika — lokale, cechy i porównywanie parami

Środowisko lokalne integracji: http://localhost:3015. Konto testowe Zenon. Obsługiwane są lokale z prawem własności oraz spółdzielczym własnościowym prawem do lokalu. Domy i działki pozostają osobnym późniejszym zakresem.

## Co obejrzeć

1. **Metoda i próba (AC01/02/05).** W nowej wycenie przejdź do Próby. Wybierz PP i kliknij „Potwierdź metodę”. Zaznacz od 3 do 5 transakcji; szóstej nie można dodać do porównania. Cała pula pozostaje zapisana. Dla KCS potrzeba co najmniej 12 transakcji.
2. **Własna cecha (AC03/04).** W Cechach wybierz „+ Inna cecha”, wpisz nazwę, wagę i opisy dostępnych ocen. To jedna cecha tej wyceny. Nazw katalogowych nie można zmieniać. Suma wag musi wynosić 100%; wagi mogą mieć części dziesiętne. Wiersze z wagą 0 nie biorą udziału w obliczeniu ani wydruku.
3. **Dwa lub trzy stopnie (AC04).** Dwa stopnie to „gorsza/lepsza”, trzy to „gorsza/przeciętna/lepsza”. Po zmianie 3→2 wcześniejsza „przeciętna” wymaga nowego wyboru — aplikacja nie ocenia za rzeczoznawcę.
4. **Oceny i poprawki PP (AC06/07).** Oceń wybrane lokale. Program proponuje mnożniki z różnicy ocen; własny mnożnik różniący się od sugestii wymaga uzasadnienia. „Zapisz oceny robocze” zachowuje pracę, a „Potwierdź oceny i poprawki i dalej” zatwierdza całą macierz. Enter w zwykłym polu nie potwierdza formularza.
5. **Opisy (AC09).** Po kalkulacji przejrzyj sześć sekcji i potwierdź je. Lokalny worker bez klucza nie wygeneruje propozycji; działają ręczne teksty. Zmiana poprawki może dezaktualizować uzasadnienie nawet przy identycznej końcowej kwocie. Twoje teksty pozostają w edytorach.
6. **Operat i wersje (AC08/10/11).** Obejrzyj PDF: własna nazwa, wagi i oceny odpowiadają formularzowi, PP ma cztery tabele i 3–5 kolumn porównań. Rodzaj prawa jest prawidłowy. W syntetycznej wycenie można sprawdzić wydanie i podpis testowym obrazem. Po podpisie korekta odbywa się przez „Utwórz nową wersję”, która ponownie wymaga potwierdzenia metody.
7. **Pomoc (AC12).** Link „Pomoc — ten krok” w Próbie i Cechach opisuje te same zasady.

## Prosty przykład do samodzielnego przeliczenia

Lokal 50 m², PP z trzema cenami 9000/9500/10000 zł/m². Jedna własna cecha 100%, skala 3; przedmiot „lepsza”, porównania kolejno „gorsza/przeciętna/lepsza”. Sugestie 1/0,5/0, poprawki 1000/500/0, każda cena po korekcie 10 000. Wynik 500 000 zł. Nie należy przenosić zaokrągleń PP do KCS — dotychczasowy rachunek KCS pozostał bez zmian.

Jeśli rezultat odbiega: zapisz adres wyceny, krok, wykonaną zmianę i oczekiwaną kwotę/tekst. Koordynator ma dowody techniczne w QA-CHECKLIST, INTEGRATION-ACCEPTANCE i przeglądach S1–S5. Ten dokument nie oznacza wdrożenia na staging ani zgody na merge do main.
