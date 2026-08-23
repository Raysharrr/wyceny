## ZADANIE

Napisz treść sekcji „Analiza i charakterystyka rynku": akapit wprowadzający (jaki rynek
i obszar analizowano i po co), wypunktowane cechy analizowanego rynku (zakres przedmiotowy,
obszar badania, pasmo powierzchni użytkowej wynikające z próby, zakres czasowy wynikający
z dat transakcji), akapit o zaobserwowanych cenach jednostkowych (minimalna, średnia,
maksymalna z próby) z podaniem liczby transakcji oraz zdanie o przedziale cen całkowitych.
NIE orzekaj o kierunku zmian cen — ani o wzroście, ani o spadku, ani o stabilności.
Obszar badania nazywaj WYŁĄCZNIE obrębami z pola `obreby` i promieniem z pola `promien_m`;
nie wymieniaj żadnego innego obrębu. Pole `obreb` to obręb WYCENIANEJ nieruchomości —
użyj go tylko w akapicie wprowadzającym, nigdy jako obszaru badania.
Liczbę przebadanych transakcji przepisz DOSŁOWNIE z pola `przebadano` — to słowo
(„kilkadziesiąt", „kilkaset"), nie zamieniaj go na cyfry ani nie doprecyzowuj.
Liczbę transakcji przyjętych do porównań (`liczba_transakcji`) podawaj dokładnie —
trafia do Tabeli 1 operatu.
Zacznij bezpośrednio od akapitu wprowadzającego — bez tytułu i bez numeru sekcji.

## PRZYKŁAD

### DANE

```json
{
 "adres": "ul. Klonowa 14/3, Nowogród",
 "dzielnica": "Zarzecze",
 "obreb": "0007 Zarzecze",
 "pow_uzytkowa": "68,40",
 "rynek": "wtórny, lokale mieszkalne, Nowogród",
 "proba": {
  "liczba_transakcji": 14,
  "zakres_dat": "03-2024 – 11-2025",
  "pow_min_m2": "58,10",
  "pow_max_m2": "79,90",
  "cena_min_zl_m2": "9 240,00",
  "cena_srednia_zl_m2": "10 815,00",
  "cena_max_zl_m2": "12 480,00",
  "cena_calkowita_min_zl": "545 000",
  "cena_calkowita_max_zl": "912 000",
  "obreby": ["Zarzecze", "Podgórze"],
  "promien_m": 1000,
  "przebadano": "kilkaset"
 }
}
```

### TEKST

Dla określenia wartości rynkowej prawa własności wycenianej nieruchomości lokalowej
o funkcji mieszkalnej przeprowadzono analizę rynku lokalnego m. Nowogród, obręb nr 0007
Zarzecze, ze szczególnym uwzględnieniem lokalizacji nieruchomości stanowiącej przedmiot
wyceny.

Cechy analizowanego rynku:

• zakres przedmiotowy – rynek wtórny nieruchomości lokalowych o funkcji mieszkalnej,
• obszar badania – m. Nowogród, obręby Zarzecze i Podgórze, w promieniu 1 000 m
  od wycenianej nieruchomości,
• powierzchnia użytkowa – od 58,10 m2 do 79,90 m2,
• zakres czasowy badania – transakcje z okresu 03-2024 – 11-2025.

W okresie monitorowania rynku lokalnego przebadano kilkaset transakcji na badanym
terenie, w których wystąpiła sprzedaż nieruchomości lokalowych o funkcji mieszkalnej.
Do porównań przyjęto 14 transakcji dotyczących lokali o powierzchni użytkowej od 58,10 m2
do 79,90 m2. Jednostkowe ceny transakcyjne znajdowały się w przedziale od 9 240,00 zł
do 12 480,00 zł za 1 m2 powierzchni użytkowej lokalu. Średnia cena jednostkowa została
ustalona na poziomie 10 815,00 zł za 1 m2. Ceny całkowite lokali przyjętych do porównań
zawierały się w przedziale od 545 000 zł do 912 000 zł.

## PRZYKŁAD

### DANE

```json
{
 "adres": "ul. Brzozowa 8/21, Nowogród",
 "dzielnica": "Podgórze",
 "obreb": "0012 Podgórze",
 "pow_uzytkowa": "46,20",
 "rynek": "wtórny, lokale mieszkalne, Nowogród",
 "proba": {
  "liczba_transakcji": 21,
  "zakres_dat": "01-2024 – 09-2025",
  "pow_min_m2": "34,80",
  "pow_max_m2": "52,40",
  "cena_min_zl_m2": "8 105,00",
  "cena_srednia_zl_m2": "9 430,00",
  "cena_max_zl_m2": "11 260,00",
  "cena_calkowita_min_zl": "310 000",
  "cena_calkowita_max_zl": "588 000",
  "obreby": ["Podgórze"],
  "promien_m": 2000,
  "przebadano": "kilkadziesiąt"
 }
}
```

### TEKST

Dla określenia wartości rynkowej prawa własności wycenianej nieruchomości lokalowej
o funkcji mieszkalnej przeprowadzono analizę rynku lokalnego m. Nowogród, obręb nr 0012
Podgórze, ze szczególnym uwzględnieniem lokalizacji nieruchomości stanowiącej przedmiot
wyceny.

Cechy analizowanego rynku:

• zakres przedmiotowy – rynek wtórny nieruchomości lokalowych o funkcji mieszkalnej,
• obszar badania – m. Nowogród, obręb Podgórze, w promieniu 2 000 m
  od wycenianej nieruchomości,
• powierzchnia użytkowa – od 34,80 m2 do 52,40 m2,
• zakres czasowy badania – transakcje z okresu 01-2024 – 09-2025.

W okresie monitorowania rynku lokalnego przebadano kilkadziesiąt transakcji na badanym
terenie, w których wystąpiła sprzedaż nieruchomości lokalowych o funkcji mieszkalnej.
Do porównań przyjęto 21 transakcji dotyczących lokali o powierzchni użytkowej od 34,80 m2
do 52,40 m2. Jednostkowe ceny transakcyjne znajdowały się w przedziale od 8 105,00 zł
do 11 260,00 zł za 1 m2 powierzchni użytkowej lokalu. Średnia cena jednostkowa została
ustalona na poziomie 9 430,00 zł za 1 m2. Ceny całkowite lokali przyjętych do porównań
zawierały się w przedziale od 310 000 zł do 588 000 zł.
