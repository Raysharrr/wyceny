## ZADANIE

Napisz 2–3 zdania do sekcji „Uzasadnienie wyniku": umiejscowienie ustalonej jednostkowej
wartości na tle próby transakcyjnej, WYŁĄCZNIE na podstawie pola `pozycja_wyniku`,
oraz wniosek o adekwatności wyniku do sytuacji na rynku lokalnym.

NIE PODAJESZ kwoty wartości rynkowej ani jednostkowej wartości wycenianego lokalu —
tych danych nie ma w DANE i nie wolno ich odtwarzać ani szacować. Jedyne kwoty, jakie
możesz przytoczyć, to ceny z próby transakcyjnej podane w DANE.

## PRZYKŁAD

### DANE

```json
{
 "pozycja_wyniku": "w przedziale cen próby, powyżej średniej",
 "proba": {
  "liczba_transakcji": 14,
  "cena_min_zl_m2": "9 240,00",
  "cena_srednia_zl_m2": "10 815,00",
  "cena_max_zl_m2": "12 480,00"
 }
}
```

### TEKST

Ustalona jednostkowa wartość wycenianego lokalu mieści się w przedziale jednostkowych cen
transakcyjnych zaobserwowanych w próbie, tj. od 9 240,00 zł do 12 480,00 zł za 1 m2,
przy czym pozostaje powyżej średniej ceny jednostkowej ustalonej na poziomie 10 815,00 zł
za 1 m2. Położenie wyniku w obrębie zaobserwowanego przedziału potwierdza jego adekwatność
w stosunku do sytuacji na lokalnym rynku nieruchomości. Wynik uznaje się za bliski cenie
możliwej do osiągnięcia w obrocie nieruchomościami na rynku lokalnym.

## PRZYKŁAD

### DANE

```json
{
 "pozycja_wyniku": "w przedziale cen próby, poniżej średniej",
 "proba": {
  "liczba_transakcji": 21,
  "cena_min_zl_m2": "8 105,00",
  "cena_srednia_zl_m2": "9 430,00",
  "cena_max_zl_m2": "11 260,00"
 }
}
```

### TEKST

Ustalona jednostkowa wartość wycenianego lokalu mieści się w przedziale jednostkowych cen
transakcyjnych zaobserwowanych w próbie, tj. od 8 105,00 zł do 11 260,00 zł za 1 m2,
przy czym pozostaje poniżej średniej ceny jednostkowej ustalonej na poziomie 9 430,00 zł
za 1 m2. Położenie wyniku w obrębie zaobserwowanego przedziału potwierdza jego adekwatność
w stosunku do sytuacji na lokalnym rynku nieruchomości. Wynik uznaje się za bliski cenie
możliwej do osiągnięcia w obrocie nieruchomościami na rynku lokalnym.
