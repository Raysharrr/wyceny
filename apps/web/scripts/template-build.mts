/**
 * `pnpm --filter web template:build` — cały pipeline szablonu w jednym poleceniu.
 *
 * Szablon NIGDY nie jest edytowany ręcznie w binarce: powstaje z generatora w
 * repo wiki, a potem z trzech idempotentnych patchy w tym repo. Dotąd trzeba
 * było pamiętać o czterech krokach i ich kolejności — pominięcie patcha dawało
 * binarkę, która przechodzi build generatora i wywraca F-12.
 *
 * Dwie zmienne środowiskowe, obie wymagane:
 *   WYCENY_WIKI      — checkout repo wiki z generatorem (worktree sesji)
 *   WYCENY_APP_WEB   — apps/web, do którego generator kopiuje szablon
 *
 * Skrypt liczy i WYPISUJE SHA-256 gotowej binarki, ale go NIE przepina —
 * pin w `tests/f12-template-integrity.test.ts` zmienia człowiek, świadomie,
 * w tym samym commicie co binarkę.
 *
 * UWAGA (zmierzone 15.09): pipeline jest odtwarzalny co do ZAWARTOŚCI, ale nie
 * bajtowo — post-processy zipa zapisują wpisy bieżącym czasem, więc SHA pliku
 * zmienia się przy każdym przebiegu, nawet gdy rozpakowane części są identyczne.
 * Determinizacja zipa to osobny temat (follow-up), nie zadanie tego skryptu.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SPIKE = "tools/spike/2026-07-15-template-koscielna";
const PATCHES = [
  "scripts/patch-template-table1.mts",
  "scripts/patch-template-table1-ulica.mts",
  "scripts/patch-template-foto-2-kolumny.mts",
];

function fail(message: string): never {
  console.error(`template:build — ${message}`);
  process.exit(1);
}

/** Ścieżka porównywalna niezależnie od dowiązań symbolicznych i końcowego „/”. */
function canonical(p: string): string {
  return fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p);
}

const wiki = process.env.WYCENY_WIKI;
if (!wiki) {
  fail(
    "brak WYCENY_WIKI. Ustaw je na worktree repo wiki z generatorem, " +
      `np. export WYCENY_WIKI=~/Development/wyceny-wiki-<sesja> (generator: ${SPIKE}/build_template.py).`,
  );
}

const appWeb = process.env.WYCENY_APP_WEB;
if (!appWeb) {
  fail(
    "brak WYCENY_APP_WEB. Ustaw je na apps/web SWOJEGO worktree, " +
      'np. export WYCENY_APP_WEB="$(pwd)" z katalogu apps/web.',
  );
}

// Generator nadpisuje templates/operat-szablon.docx i src/domain/operat-sections.ts
// w katalogu, który wskazuje WYCENY_APP_WEB. Wskazanie głównego checkoutu z
// worktree sesji cicho psuje cudzą pracę — i tak samo cicho zostawia binarkę
// tej sesji bez zmian.
const mainCheckout = path.join(os.homedir(), "Development", "wyceny-app", "apps", "web");
if (canonical(appWeb) === canonical(mainCheckout)) {
  fail(
    `WYCENY_APP_WEB wskazuje główny checkout app-repo (${mainCheckout}). ` +
      "Generator zapisuje szablon w tym katalogu — ustaw apps/web swojego worktree.",
  );
}

const generator = path.join(wiki, SPIKE, "build_template.py");
if (!fs.existsSync(generator)) {
  fail(`nie ma generatora pod ${generator}. Czy WYCENY_WIKI wskazuje repo wiki?`);
}

// Generator wymaga python-docx i lxml; w spike'u stoi na to venv (README spike'a).
// Gołe python3 zwykle ich nie ma, więc venv ma pierwszeństwo, a jego brak jest
// komunikatem z przepisem, nie błędem importu dwadzieścia linii niżej.
const venvPython = path.join(wiki, SPIKE, ".venv", "bin", "python");
const python = fs.existsSync(venvPython) ? venvPython : "python3";

function run(command: string, args: string[], cwd: string): void {
  console.log(`\n$ ${path.basename(command)} ${args.join(" ")}   (w ${cwd})`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, WYCENY_APP_WEB: appWeb },
  });
  if (result.error) fail(`nie udało się uruchomić ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${path.basename(command)} zakończył się kodem ${result.status}`);
}

run(python, ["build_template.py"], path.join(wiki, SPIKE));
for (const patch of PATCHES) {
  run("pnpm", ["tsx", patch], appWeb);
}

const template = path.join(appWeb, "templates", "operat-szablon.docx");
const sha = createHash("sha256").update(fs.readFileSync(template)).digest("hex");
console.log(`\n${template}`);
console.log(`SHA-256 = ${sha}`);
console.log(
  "Pin w tests/f12-template-integrity.test.ts przepina człowiek — ten skrypt go nie rusza.",
);
