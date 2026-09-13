# Zamrożony punkt odniesienia podpisu — 2026-09-13

Wygenerowano DOCX bieżącym nietkniętym kodem i szablonem9b2903c, przed zmianami produkcyjnymi S1–S4. Dwa syntetyczne warianty: własność i prawo spółdzielcze, wagi40,25%/30%/29,75%, proza testowa, brak method/ratingScale. `baseline.json` zawiera komplet wejścia, SHA tekstu i SHA szablonu. Przy odtwarzaniu wejścia przywrócić approvedAt jako Date.

Pliki DOCX i pełny tekst lokalnie: `/tmp/pairwise-legacy-render/`. W repo przechowujemy syntetyczne wejścia i skróty; S4 porówna signed render ze skrótem9b2903c, a nie dwoma renderami tego samego nowego kodu. To dowód zachowania na tej granicy wdrożenia, nie dowód odtworzenia wszystkich wcześniejszych historycznych wersji.

Ekstrakcja tekstu dokładnie jak dotychczasowy docx-render-signature.test: znaczniki XML→`|`, ciągi`|`→spacja, trim. Bez usuwania liczb, opisów i etykiet. Cały tekst starego dokumentu pozostaje kontrolowany.

Skrypt capture jest narzędziem rejestracji baseline, nie komendą do odświeżania oczekiwań po zmianie szablonu. Fixture bazowa używa wyłącznie danych syntetycznych istniejącego zestawu testowego; słowna kwota jest celowo opisana jako wynik syntetyczny.
