/**
 * Czy fabryka fikstur wydaje każdemu wywołaniu WŁASNE dane.
 *
 * Fikstura, która oddaje stałą modułową przez referencję, pozwala jednemu
 * testowi zapisać dane następnemu — i wtedy o wyniku decyduje kolejność
 * przebiegu, czego przy zielonym CI nikt nie zobaczy. Groźniejsza strona tego
 * przecieku jest taka, że test dostaje dane spreparowane przez poprzednika, więc
 * może ZAMASKOWAĆ prawdziwy błąd, a nie tylko wywołać fałszywy alarm.
 *
 * Automat, a nie lista pól, z tego samego powodu, dla którego `structuredClone`
 * bije kopiowanie po kolei: trzy kolejne przeglądy „po oku" tego samego kodu
 * dały 1, 3 i 5 przecieków (15.09). Rekurencyjne porównanie dwóch wywołań jest
 * jedyną formą, która odpowiada na pytanie „czy to już wszystkie", i obejmuje
 * też pola dopisane w przyszłości.
 */

/** Ścieżka do każdej referencji współdzielonej przez dwa wywołania fabryki. */
export function sharedReferences(a: unknown, b: unknown, path = ""): string[] {
  // Prymitywy porównują się przez wartość — współdzielenie ich jest nieszkodliwe
  // i nieuniknione. Interesują nas tylko obiekty, bo tylko je da się zapisać.
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return [];
  // Data też jest obiektem i też da się ją zapisać (`setFullYear`), więc nie
  // robimy dla niej wyjątku — `structuredClone` i tak ją kopiuje.
  if (a === b) return [path || "(cały obiekt)"];
  if (a instanceof Date || b instanceof Date) return [];

  const found: string[] = [];
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      found.push(...sharedReferences(a[i], b[i], `${path}[${i}]`));
    }
    return found;
  }
  const rekord = a as Record<string, unknown>;
  const drugi = b as Record<string, unknown>;
  for (const key of Object.keys(rekord)) {
    if (!(key in drugi)) continue;
    found.push(...sharedReferences(rekord[key], drugi[key], path ? `${path}.${key}` : key));
  }
  return found;
}

/**
 * Ścieżki współdzielone przez dwa wywołania `factory`. Pusta tablica = każde
 * wywołanie dostaje własne dane. Wołaj z `toEqual([])`, żeby komunikat błędu
 * wypisał, KTÓRE pola przeciekają — sama liczba nic nie mówi.
 */
export function leakingPaths(factory: () => unknown): string[] {
  return sharedReferences(factory(), factory());
}
