# Moduł Pomoc — Implementation Plan (Slice 13)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudować moduł Pomoc pod `/pomoc` (za logowaniem) opisujący całą wdrożoną funkcjonalność w dwóch drzewach — zadaniowym i referencyjnym — z wyszukiwarką pełnotekstową i trzema wejściami z aplikacji.

**Architecture:** Treść w plikach MDX obok kodu (`src/content/pomoc/`), struktura nawigacji w `manifest.ts`, renderowanie przez jedną trasę dynamiczną `[slug]`. Wyszukiwarka client-side na indeksie generowanym z MDX w `prebuild`. Zero zmian w silniku, workerze, szablonie i schemacie bazy — jedyny wyjątek to mechaniczne wyodrębnienie stałych zaokrągleń w fali 2.

**Tech Stack:** Next 16.2.9 (App Router), React 19.2.4, `@next/mdx`, TypeScript, vitest + Testing Library, Playwright (smoke), pnpm + Turborepo.

**Spec:** `docs/superpowers/specs/2026-07-27-modul-pomoc-design.md`

## Global Constraints

- **Zamrożone — nie dotykać:** `packages/shared/**`, `apps/worker/**`, `apps/web/src/db/**` i wszystkie migracje, generator dokumentu i szablon operatu, `apps/web/src/domain/kcs.ts` **poza Taskiem 10**. Golden **F-1 = 1 044 400 zł** musi zostać nietknięty przez cały slice.
- **Brak migracji DDL** w tym slice'ie.
- **Etykiety przycisków objęte smoke pozostają byte-identical.**
- **Vitest:** globalne środowisko to `node`; testy DOM-owe wymagają pragmy `// @vitest-environment jsdom` w pierwszej linii pliku. **Brak globals** — jawne `import { describe, it, expect } from "vitest"` oraz `import "@testing-library/jest-dom/vitest"` tam, gdzie używane są matchery DOM.
- **Lokalizacja testów: `apps/web/tests/`** — tam mieszka wszystkie 65 istniejących plików testowych repo; testy DOM-owe z prefiksem `rtl-`. Testowany moduł importuj przez alias (`@/app/pomoc/page`), nie ścieżką względną. Nie zakładamy katalogów `__tests__` obok kodu. _(Poprawka po review Taska 1 — pierwotny plan wprowadzał niepotrzebny rozjazd konwencji.)_
- **Auto-cleanup RTL nie działa bez globals** — każdy plik testowy DOM potrzebuje `afterEach(cleanup)`. Gdy mocki są w zasięgu modułu, dołóż `beforeEach(() => vi.clearAllMocks())`, inaczej liczniki wywołań przeciekają między testami.
- **Test guardu sesji musi asertować OBIE strony** — że przekierowanie następuje bez sesji **i że NIE następuje z sesją** (`expect(redirect).not.toHaveBeenCalled()`). Mockowany `redirect` nie przerywa wykonania, więc bezwarunkowe `redirect("/login")` — czyli strona niedostępna dla wszystkich — przechodzi testy sprawdzające tylko pierwszy warunek. Realna wada złapana w review Taska 1 przez mutation testing.
- **Język:** kod, nazwy plików i identyfikatory po angielsku; **treść MDX i copy UI po polsku**.
- **Środowisko robocze to staging** (`https://wyceny-mu.vercel.app`) — tak je opisujemy w raportach; produkcji jeszcze nie ma.
- **Ochrona tras per strona** — `getSession()` + `redirect`, wzorzec z `valuations`/`profile`; `AppShellLayout` sam nie blokuje.
- **Zero martwych linków** (zasada ze Slice'a 12): odnośnik do strony Pomocy renderuje się wyłącznie wtedy, gdy ta strona istnieje w manifeście.
- Commit po każdym tasku; `git push` po każdym tasku (auto-deploy na staging ~50 s, stany pośrednie zaakceptowane).

---

# FALA 1 — szkielet i instrukcja obsługi

### Task 1: Konfiguracja MDX i trasa `/pomoc` za logowaniem

**Files:**

- Modify: `apps/web/next.config.ts`
- Modify: `apps/web/package.json` (zależności)
- Create: `apps/web/src/mdx-components.tsx`
- Create: `apps/web/src/app/pomoc/layout.tsx`
- Create: `apps/web/src/app/pomoc/page.tsx`
- Test: `apps/web/tests/rtl-pomoc-page.test.tsx`

**Interfaces:**

- Consumes: `getSession` z `@/auth/session`, `AppShellLayout` z `@/components/app-shell-layout`
- Produces: działającą trasę `/pomoc` chronioną sesją; konfigurację MDX, na której opierają się Taski 2, 7, 8, 11–13. `mdx-components.tsx` eksportuje `useMDXComponents` — wymagane przez `@next/mdx` w App Routerze.

- [ ] **Step 1: Dodaj zależności MDX**

```bash
cd ~/Development/wyceny-app/apps/web && pnpm add @next/mdx @mdx-js/loader @mdx-js/react @types/mdx
```

- [ ] **Step 2: Napisz failing test trasy**

Plik `apps/web/tests/rtl-pomoc-page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const getSession = vi.fn();
vi.mock("@/auth/session", () => ({ getSession: () => getSession() }));

import Page from "../page";

describe("/pomoc", () => {
  it("przekierowuje na login bez sesji", async () => {
    getSession.mockResolvedValueOnce(null);
    await Page();
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("renderuje naglowek Pomocy dla zalogowanego", async () => {
    getSession.mockResolvedValueOnce({
      user: { name: "Test", email: "t@t.pl", role: "appraiser" },
    });
    render(await Page());
    expect(screen.getByRole("heading", { name: /pomoc/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Uruchom test — musi paść**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run tests/rtl-pomoc-page.test.tsx`
Expected: FAIL — brak modułu `../page`

- [ ] **Step 4: Skonfiguruj MDX**

`apps/web/next.config.ts` — owinąć istniejącą konfigurację (nie zmieniamy `pageExtensions`, bo MDX **nie są trasami**, tylko importowaną treścią):

```ts
import createMDX from "@next/mdx";

const withMDX = createMDX({});

// ...istniejący nextConfig bez zmian...

export default withMDX(nextConfig);
```

`apps/web/src/mdx-components.tsx`:

```tsx
import type { MDXComponents } from "mdx/types";

/** Wymagane przez @next/mdx w App Routerze. Typografia Pomocy w jednym miejscu. */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h2: (props) => <h2 className="mt-8 mb-3 text-[19px] font-semibold" {...props} />,
    h3: (props) => <h3 className="mt-6 mb-2 text-[16px] font-semibold" {...props} />,
    p: (props) => <p className="mb-4 max-w-[70ch] text-[14.5px] leading-relaxed" {...props} />,
    ul: (props) => <ul className="mb-4 ml-5 list-disc space-y-1 text-[14.5px]" {...props} />,
    ol: (props) => <ol className="mb-4 ml-5 list-decimal space-y-1 text-[14.5px]" {...props} />,
    ...components,
  };
}
```

- [ ] **Step 5: Zaimplementuj trasę**

`apps/web/src/app/pomoc/layout.tsx`:

```tsx
export { AppShellLayout as default } from "@/components/app-shell-layout";
```

`apps/web/src/app/pomoc/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <main className="mx-auto max-w-[1100px] px-6 py-8">
      <h1 className="mb-2 text-[25px] font-semibold tracking-[-0.015em]">Pomoc</h1>
      <p className="max-w-[70ch] text-[14.5px] text-muted-foreground">
        Instrukcja obsługi aplikacji oraz opis metody, na której opieramy wyniki.
      </p>
    </main>
  );
}
```

- [ ] **Step 6: Uruchom testy — muszą przejść**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run tests/rtl-pomoc-page.test.tsx`
Expected: PASS (2 testy)

- [ ] **Step 7: Zweryfikuj build z MDX (Turbopack)**

Run: `cd ~/Development/wyceny-app && pnpm build --filter=web`
Expected: build zielony. **Jeśli `@next/mdx` nie współpracuje z Turbopackiem w tej wersji Next**, zanotuj błąd i przełącz konfigurację zgodnie z aktualną dokumentacją (delegacja do `context7`/skilla `vercel:nextjs` — nie zgaduj z pamięci).

- [ ] **Step 8: Commit i push**

```bash
cd ~/Development/wyceny-app && git add -A && git commit -m "feat: mdx setup and /pomoc route behind auth" && git push
```

---

### Task 2: Manifest treści i renderer stron

**Files:**

- Create: `apps/web/src/content/pomoc/manifest.ts`
- Create: `apps/web/src/content/pomoc/jak-korzystac/pierwsze-kroki.mdx`
- Create: `apps/web/src/app/pomoc/[slug]/page.tsx`
- Test: `apps/web/tests/help-manifest.test.ts`

**Interfaces:**

- Consumes: konfigurację MDX z Taska 1
- Produces: `HELP_PAGES: HelpPage[]` gdzie `HelpPage = { slug: string; title: string; tree: "jak-korzystac" | "metodyka"; order: number; tags: string[]; summary: string; load: () => Promise<{ default: React.ComponentType }> }`. Wszystkie kolejne taski dopisują wpisy do tej tablicy i pliki MDX. `getPage(slug)` zwraca wpis albo `undefined`.

- [ ] **Step 1: Napisz failing test manifestu**

Plik `apps/web/tests/help-manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HELP_PAGES, getPage } from "../manifest";

describe("manifest Pomocy", () => {
  it("ma unikalne slugi", () => {
    const slugs = HELP_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("kazda strona ma tytul, drzewo i streszczenie", () => {
    for (const page of HELP_PAGES) {
      expect(page.title.length).toBeGreaterThan(0);
      expect(["jak-korzystac", "metodyka"]).toContain(page.tree);
      expect(page.summary.length).toBeGreaterThan(0);
    }
  });

  it("kazda strona da sie zaladowac", async () => {
    for (const page of HELP_PAGES) {
      const mod = await page.load();
      expect(typeof mod.default).toBe("function");
    }
  });

  it("getPage zwraca undefined dla nieznanego sluga", () => {
    expect(getPage("nie-ma-takiej")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Uruchom test — musi paść**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run tests/help-manifest.test.ts`
Expected: FAIL — brak modułu `../manifest`

- [ ] **Step 3: Utwórz pierwszą stronę MDX**

`apps/web/src/content/pomoc/jak-korzystac/pierwsze-kroki.mdx` — na tym etapie szkielet, pełna treść w Tasku 7:

```mdx
## Zanim zaczniesz

Aplikacja służy do sporządzania operatów szacunkowych metodą korygowania ceny średniej.
Dostęp jest zamknięty — konto zakłada administrator.

## Lista wycen

Po zalogowaniu widzisz listę swoich wycen. Kliknięcie wiersza otwiera wycenę.
```

- [ ] **Step 4: Zaimplementuj manifest**

`apps/web/src/content/pomoc/manifest.ts`:

```ts
import type { ComponentType } from "react";

export type HelpTree = "jak-korzystac" | "metodyka";

export type HelpPage = {
  slug: string;
  title: string;
  tree: HelpTree;
  order: number;
  tags: string[];
  summary: string;
  load: () => Promise<{ default: ComponentType }>;
};

export const TREE_LABEL: Record<HelpTree, string> = {
  "jak-korzystac": "Jak korzystać",
  metodyka: "Na czym opieramy wynik",
};

/** Jedyne źródło struktury nawigacji. Importy MUSZĄ być statyczne — bundler
 *  nie znajdzie celu sklejanego ze zmiennej. */
export const HELP_PAGES: HelpPage[] = [
  {
    slug: "pierwsze-kroki",
    title: "Pierwsze kroki",
    tree: "jak-korzystac",
    order: 1,
    tags: ["konto", "lista wycen", "start"],
    summary: "Logowanie, lista wycen i utworzenie pierwszej wyceny.",
    load: () => import("./jak-korzystac/pierwsze-kroki.mdx"),
  },
];

export const getPage = (slug: string): HelpPage | undefined =>
  HELP_PAGES.find((page) => page.slug === slug);

export const pagesInTree = (tree: HelpTree): HelpPage[] =>
  HELP_PAGES.filter((page) => page.tree === tree).sort((a, b) => a.order - b.order);
```

- [ ] **Step 5: Zaimplementuj renderer**

`apps/web/src/app/pomoc/[slug]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { HELP_PAGES, getPage } from "@/content/pomoc/manifest";

export const generateStaticParams = async () => HELP_PAGES.map(({ slug }) => ({ slug }));

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { slug } = await params;
  const page = getPage(slug);
  if (!page) notFound();

  const { default: Content } = await page.load();
  return (
    <main className="mx-auto max-w-[1100px] px-6 py-8">
      <h1 className="mb-6 text-[25px] font-semibold tracking-[-0.015em]">{page.title}</h1>
      <article>
        <Content />
      </article>
    </main>
  );
}
```

- [ ] **Step 6: Uruchom testy — muszą przejść**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run tests/help-manifest.test.ts`
Expected: PASS (4 testy)

- [ ] **Step 7: Commit i push**

```bash
cd ~/Development/wyceny-app && git add -A && git commit -m "feat: help content manifest and dynamic page renderer" && git push
```

---

### Task 3: Nawigacja po dwóch drzewach

**Files:**

- Modify: `apps/web/src/app/pomoc/page.tsx`
- Create: `apps/web/src/components/help/help-nav.tsx`
- Test: `apps/web/tests/rtl-help-nav.test.tsx`

**Interfaces:**

- Consumes: `pagesInTree`, `TREE_LABEL` z manifestu (Task 2)
- Produces: `<HelpNav />` — spis obu drzew; drzewo bez stron renderuje notkę „wkrótce" zamiast pustej listy. Task 14 usuwa tę notkę, gdy dojdzie treść metodyczna.

- [ ] **Step 1: Napisz failing test**

Plik `apps/web/tests/rtl-help-nav.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HelpNav } from "../help-nav";

describe("HelpNav", () => {
  it("pokazuje oba drzewa", () => {
    render(<HelpNav />);
    expect(screen.getByRole("heading", { name: "Jak korzystać" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Na czym opieramy wynik" })).toBeInTheDocument();
  });

  it("linkuje do stron po slugu", () => {
    render(<HelpNav />);
    const link = screen.getByRole("link", { name: /pierwsze kroki/i });
    expect(link).toHaveAttribute("href", "/pomoc/pierwsze-kroki");
  });

  it("pokazuje notke zamiast pustej listy w drzewie bez stron", () => {
    render(<HelpNav />);
    expect(screen.getByText(/wkrótce/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Uruchom test — musi paść**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run tests/rtl-help-nav.test.tsx tests/rtl-help-search.test.tsx`
Expected: FAIL — brak modułu `../help-nav`

- [ ] **Step 3: Zaimplementuj nawigację**

`apps/web/src/components/help/help-nav.tsx`:

```tsx
import Link from "next/link";
import { TREE_LABEL, pagesInTree, type HelpTree } from "@/content/pomoc/manifest";

const TREES: HelpTree[] = ["jak-korzystac", "metodyka"];

export function HelpNav() {
  return (
    <div className="grid gap-8 md:grid-cols-2">
      {TREES.map((tree) => {
        const pages = pagesInTree(tree);
        return (
          <section key={tree}>
            <h2 className="mb-3 text-[16px] font-semibold">{TREE_LABEL[tree]}</h2>
            {pages.length === 0 ? (
              <p className="text-[14px] text-muted-foreground">Wkrótce.</p>
            ) : (
              <ul className="space-y-2">
                {pages.map((page) => (
                  <li key={page.slug}>
                    <Link href={`/pomoc/${page.slug}`} className="text-[14.5px] hover:underline">
                      {page.title}
                    </Link>
                    <p className="text-[13px] text-muted-foreground">{page.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Wepnij nawigację w stronę Pomocy**

W `apps/web/src/app/pomoc/page.tsx` dodaj `import { HelpNav } from "@/components/help/help-nav";` i wstaw `<HelpNav />` pod akapitem wprowadzającym, wewnątrz `<main>`.

- [ ] **Step 5: Uruchom testy — muszą przejść**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run tests/rtl-help-nav.test.tsx tests/rtl-pomoc-page.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit i push**

```bash
cd ~/Development/wyceny-app && git add -A && git commit -m "feat: help navigation for both content trees" && git push
```

---

### Task 4: Indeks wyszukiwania i wyszukiwarka

**Files:**

- Create: `apps/web/src/lib/help-search.ts`
- Create: `apps/web/scripts/build-help-index.ts`
- Modify: `apps/web/package.json` (skrypty `prebuild`, `predev`)
- Modify: `.gitignore`
- Create: `apps/web/src/components/help/help-search.tsx`
- Test: `apps/web/tests/help-search.test.ts`
- Test: `apps/web/tests/rtl-help-search.test.tsx`

**Interfaces:**

- Consumes: pliki MDX i `manifest.ts`
- Produces: `apps/web/src/content/pomoc/search-index.json` (generowany, gitignorowany) w kształcie `HelpIndexEntry = { slug: string; title: string; tree: HelpTree; tags: string[]; text: string }`; funkcje czyste `stripMdx(source)`, `normalize(value)`, `searchIndex(index, query)` w `src/lib/help-search.ts` — **jedno źródło dla skryptu budującego, komponentu i testów**.

> **Dlaczego skrypt jest w TypeScripcie, a nie w `.mjs`:** funkcje czyste muszą być współdzielone przez skrypt (Node) i komponent (bundler). Plik `.mjs` importowany z testu `.ts` przechodzi w vitest, ale wywraca `pnpm typecheck` na braku deklaracji. `tsx` jest już zależnością repo (używa go `pnpm seed`), więc skrypt w TS eliminuje ten problem bez dokładania czegokolwiek.

- [ ] **Step 1: Napisz failing testy funkcji czystych**

Plik `apps/web/tests/help-search.test.ts`:

````ts
import { describe, expect, it } from "vitest";
import { normalize, searchIndex, stripMdx } from "../help-search";

describe("stripMdx", () => {
  it("usuwa naglowki, importy i bloki kodu", () => {
    const out = stripMdx('import X from "y";\n\n## Tytul\n\n```js\nconst a = 1;\n```\n\nTresc.');
    expect(out).not.toContain("import");
    expect(out).not.toContain("const a");
    expect(out).toContain("Tytul");
    expect(out).toContain("Tresc");
  });
});

describe("normalize", () => {
  it("usuwa diakrytyki i wielkosc liter", () => {
    expect(normalize("Księga Wieczysta")).toBe("ksiega wieczysta");
  });
});

describe("searchIndex", () => {
  const index = [
    {
      slug: "a",
      title: "Próba porównawcza",
      tree: "jak-korzystac",
      tags: ["RCN"],
      text: "transakcje z rejestru",
    },
    { slug: "b", title: "Operat", tree: "metodyka", tags: [], text: "dokument koncowy" },
  ];

  it("znajduje po tresci, nie tylko po tytule", () => {
    expect(searchIndex(index, "rejestru").map((r) => r.slug)).toEqual(["a"]);
  });

  it("ignoruje diakrytyki w zapytaniu", () => {
    expect(searchIndex(index, "probA").map((r) => r.slug)).toEqual(["a"]);
  });

  it("zwraca pusto dla braku trafien", () => {
    expect(searchIndex(index, "hipoteka")).toEqual([]);
  });
});
````

- [ ] **Step 2: Uruchom testy — muszą paść**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run tests/help-search.test.ts`
Expected: FAIL — brak modułu `../help-search`

- [ ] **Step 3: Zaimplementuj funkcje czyste**

`apps/web/src/lib/help-search.ts`:

````ts
import type { HelpTree } from "@/content/pomoc/manifest";

export type HelpIndexEntry = {
  slug: string;
  title: string;
  tree: HelpTree;
  tags: string[];
  text: string;
};

/** Zdejmuje składnię MDX, zostawiając sam tekst do indeksowania. */
export const stripMdx = (source: string): string =>
  source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^import .*$/gm, " ")
    .replace(/^export .*$/gm, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_>`|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Składanie bez diakrytyków i wielkości liter — „Księga" ma się znaleźć na „ksiega". */
export const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase();

export const searchIndex = (index: HelpIndexEntry[], query: string): HelpIndexEntry[] => {
  const needle = normalize(query).trim();
  if (!needle) return [];
  return index.filter((entry) =>
    normalize([entry.title, entry.text, entry.tags.join(" ")].join(" ")).includes(needle),
  );
};
````

- [ ] **Step 4: Zaimplementuj skrypt budujący indeks**

`apps/web/scripts/build-help-index.ts` (uruchamiany przez `tsx`):

```ts
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { HELP_PAGES } from "../src/content/pomoc/manifest";
import { stripMdx, type HelpIndexEntry } from "../src/lib/help-search";

const CONTENT = path.join(import.meta.dirname, "..", "src", "content", "pomoc");
const OUT = path.join(CONTENT, "search-index.json");

const collect = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(full)));
    else if (entry.name.endsWith(".mdx")) files.push(full);
  }
  return files;
};

const main = async () => {
  const files = await collect(CONTENT);
  const bySlug = new Map(HELP_PAGES.map((page) => [page.slug, page]));
  const index: HelpIndexEntry[] = [];

  for (const file of files) {
    const slug = path.basename(file, ".mdx");
    const page = bySlug.get(slug);
    // Strona-widmo w wynikach wyszukiwania byłaby gorsza niż jej brak — przerywamy build.
    if (!page)
      throw new Error(`Plik ${slug}.mdx nie ma wpisu w manifest.ts — dodaj wpis albo usun plik.`);
    index.push({
      slug,
      title: page.title,
      tree: page.tree,
      tags: page.tags,
      text: stripMdx(await readFile(file, "utf8")),
    });
    bySlug.delete(slug);
  }

  if (bySlug.size > 0) {
    throw new Error(`Manifest wymienia strony bez pliku MDX: ${[...bySlug.keys()].join(", ")}`);
  }

  await writeFile(OUT, JSON.stringify(index, null, 2), "utf8");
  console.log(`search-index.json: ${index.length} stron`);
};

await main();
```

- [ ] **Step 5: Podepnij skrypt i wyklucz artefakt z gita**

W `apps/web/package.json` dodaj do `scripts`:

```json
"prebuild": "tsx scripts/build-help-index.ts",
"predev": "tsx scripts/build-help-index.ts"
```

Do `.gitignore` dodaj linię:

```
apps/web/src/content/pomoc/search-index.json
```

- [ ] **Step 6: Napisz failing test wyszukiwarki**

Plik `apps/web/tests/rtl-help-search.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { HelpSearch } from "../help-search";

const index = [
  {
    slug: "krok-3-proba",
    title: "Krok 3 — Próba",
    tree: "jak-korzystac",
    tags: [],
    text: "transakcje z rejestru RCN",
  },
];

describe("HelpSearch", () => {
  it("pokazuje trafienie po tresci", async () => {
    render(<HelpSearch index={index} />);
    await userEvent.type(screen.getByRole("searchbox"), "rejestru");
    expect(screen.getByRole("link", { name: /krok 3/i })).toHaveAttribute(
      "href",
      "/pomoc/krok-3-proba",
    );
  });

  it("informuje o braku wynikow", async () => {
    render(<HelpSearch index={index} />);
    await userEvent.type(screen.getByRole("searchbox"), "hipoteka");
    expect(screen.getByText(/brak wyników/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Zaimplementuj wyszukiwarkę**

`apps/web/src/components/help/help-search.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TREE_LABEL } from "@/content/pomoc/manifest";
import { searchIndex, type HelpIndexEntry } from "@/lib/help-search";

export function HelpSearch({ index }: { index: HelpIndexEntry[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchIndex(index, query), [index, query]);
  const asked = query.trim().length > 0;

  return (
    <div className="mb-8">
      <label htmlFor="help-search" className="mb-2 block text-[13px] font-medium">
        Szukaj w Pomocy
      </label>
      <input
        id="help-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="np. próba, plan miejscowy, zaokrąglenia"
        className="w-full max-w-[520px] rounded-md border px-3 py-2 text-[14.5px]"
      />
      {asked && results.length === 0 && (
        <p className="mt-3 text-[14px] text-muted-foreground">Brak wyników.</p>
      )}
      {asked && results.length > 0 && (
        <ul className="mt-3 space-y-2">
          {results.map((entry) => (
            <li key={entry.slug}>
              <Link href={`/pomoc/${entry.slug}`} className="text-[14.5px] hover:underline">
                {entry.title}
              </Link>
              <span className="ml-2 text-[12.5px] text-muted-foreground">
                {TREE_LABEL[entry.tree]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Wepnij wyszukiwarkę w stronę Pomocy**

W `apps/web/src/app/pomoc/page.tsx` zaimportuj wygenerowany indeks i przekaż go do komponentu nad `<HelpNav />`:

```tsx
import index from "@/content/pomoc/search-index.json";
import { HelpSearch } from "@/components/help/help-search";
import type { HelpIndexEntry } from "@/lib/help-search";

// ...w JSX, nad <HelpNav />:
<HelpSearch index={index as HelpIndexEntry[]} />;
```

Uwaga: `search-index.json` jest gitignorowany, więc **musi istnieć przed pierwszym buildem** — `prebuild`/`predev` go tworzą. Jeśli `tsc --noEmit` zgłosi brak modułu przy czystym klonie, dodaj `resolveJsonModule` (jeśli jeszcze nie ma) i wygeneruj indeks przed typecheckiem.

- [ ] **Step 9: Uruchom testy i build**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run && cd ~/Development/wyceny-app && pnpm build --filter=web`
Expected: testy PASS, build zielony, w logu linia `search-index.json: N stron`

- [ ] **Step 10: Commit i push**

```bash
cd ~/Development/wyceny-app && git add -A && git commit -m "feat: full-text help search over generated index" && git push
```

---

### Task 5: Wejście z menu pod awatarem

**Files:**

- Modify: `apps/web/src/components/avatar-menu.tsx`
- Test: `apps/web/tests/rtl-avatar-menu.test.tsx` (rozszerzyć istniejący, jeśli jest)

**Interfaces:**

- Consumes: istniejący komponent `AvatarMenu` (Slice 12, Task 15)
- Produces: pozycję „Pomoc" prowadzącą do `/pomoc`, wstawioną **nad** „Profil i ustawienia".

- [ ] **Step 1: Napisz failing test**

Dopisz do testów `AvatarMenu` przypadek: po otwarciu menu istnieje `link` o nazwie `/pomoc/i` z atrybutem `href="/pomoc"`. Jeśli plik testowy nie istnieje, utwórz go w konwencji z Taska 3 (pragma jsdom, jawne importy, `userEvent` do otwarcia menu).

- [ ] **Step 2: Uruchom test — musi paść**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run tests/rtl-avatar-menu.test.tsx`
Expected: FAIL — brak pozycji „Pomoc"

- [ ] **Step 3: Dodaj pozycję menu**

W `avatar-menu.tsx` dodaj element menu „Pomoc" z `href="/pomoc"` przed pozycją „Profil i ustawienia", zachowując istniejącą konwencję komponentów Radix użytą w tym pliku (nie zmieniaj mechaniki wylogowania przez `form=`).

- [ ] **Step 4: Uruchom testy — muszą przejść**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run tests/rtl-avatar-menu.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit i push**

```bash
cd ~/Development/wyceny-app && git add -A && git commit -m "feat: help entry in avatar menu" && git push
```

---

### Task 6: Wejście ze znaku zapytania w nagłówku kroku

**Files:**

- Modify: `apps/web/src/components/wizard/step-meta.ts`
- Modify: `apps/web/src/components/wizard/step-header.tsx`
- Test: `apps/web/tests/rtl-step-header.test.tsx`

**Interfaces:**

- Consumes: `STEP_META` (Slice 12), `getPage` z manifestu
- Produces: opcjonalne pole `helpSlug` w każdym wpisie `STEP_META`; `StepHeader` renderuje ikonę-link **wyłącznie** gdy `helpSlug` jest podany **i** strona istnieje w manifeście (zasada zero martwych linków).

- [ ] **Step 1: Napisz failing testy**

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StepHeader } from "../step-header";

describe("StepHeader — wejscie do Pomocy", () => {
  it("renderuje link do Pomocy dla kroku z istniejaca strona", () => {
    render(<StepHeader step={1} />);
    expect(screen.getByRole("link", { name: /pomoc/i })).toHaveAttribute(
      "href",
      "/pomoc/krok-1-przedmiot",
    );
  });

  it("nie renderuje linku, gdy strona nie istnieje w manifescie", () => {
    render(<StepHeader step={6} />);
    expect(screen.queryByRole("link", { name: /pomoc/i })).toBeNull();
  });
});
```

Uwaga: drugi przypadek działa dopóki strona kroku 6 nie istnieje (dochodzi w Tasku 8). **W Tasku 8 ten test trzeba przepiąć** na wpis kontrolny bez strony — zanotuj to w ledgerze jako carry-forward.

- [ ] **Step 2: Uruchom testy — muszą paść**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run tests/rtl-step-header.test.tsx`
Expected: FAIL — brak linku

- [ ] **Step 3: Dodaj `helpSlug` do metadanych kroków**

W `step-meta.ts` dopisz do każdego wpisu pole `helpSlug`: krok 1 → `"krok-1-przedmiot"`, 2 → `"krok-2-ogledziny"`, 3 → `"krok-3-proba"`, 4 → `"krok-4-cechy"`, 5 → `"krok-5-kalkulacja"`, 6 → `"krok-6-opisy"`, 7 → `"krok-7-operat"`.

- [ ] **Step 4: Wyrenderuj warunkowy link**

W `step-header.tsx` obok `<h1>` dodaj link do `/pomoc/${helpSlug}` renderowany tylko gdy `helpSlug && getPage(helpSlug)`. Link musi mieć dostępną nazwę zawierającą „Pomoc" (np. `aria-label="Pomoc — ten krok"`), ikona wizualnie dyskretna, wyrównana do prawej strony nagłówka.

- [ ] **Step 5: Uruchom testy — muszą przejść**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run tests/rtl-step-header.test.tsx tests/rtl-step-inspection.test.tsx`
Expected: PASS, bez regresji pozostałych testów wizarda

- [ ] **Step 6: Commit i push**

```bash
cd ~/Development/wyceny-app && git add -A && git commit -m "feat: contextual help link in wizard step headers" && git push
```

---

### Task 7: Treść — pierwsze kroki i kroki 1–3

**Files:**

- Modify: `apps/web/src/content/pomoc/jak-korzystac/pierwsze-kroki.mdx`
- Create: `apps/web/src/content/pomoc/jak-korzystac/krok-1-przedmiot.mdx`
- Create: `apps/web/src/content/pomoc/jak-korzystac/krok-2-ogledziny.mdx`
- Create: `apps/web/src/content/pomoc/jak-korzystac/krok-3-proba.mdx`
- Modify: `apps/web/src/content/pomoc/manifest.ts`

**Interfaces:**

- Consumes: manifest (Task 2)
- Produces: cztery strony treści z wpisami w `HELP_PAGES` (`order` 1–4, `tree: "jak-korzystac"`).

**Metoda pisania (obowiązkowa):** treść **wyprowadzasz z kodu, nie z wyobraźni**. Dla każdej strony najpierw przeczytaj odpowiadający jej kod, potem pisz. Źródła: krok 1 → `src/app/valuations/**` (formularz kroku 1), `src/domain/subject-snapshot.ts`, worker `app/subject.py`; krok 2 → `src/domain/inspection.ts`, worker `app/photo.py`; krok 3 → `src/domain/valuation.ts` (próba), worker `app/rcn.py`. **Nie opisuj zachowań, których nie znalazłeś w kodzie.** Jeśli czegoś nie da się ustalić — pomiń i zanotuj w raporcie.

- [ ] **Step 1: Napisz treść czterech stron**

Każda strona ma stały układ: akapit wprowadzający („co robisz na tym kroku"), sekcja „Co wypełnia się samo" (jeśli dotyczy), sekcja „Co musisz uzupełnić ręcznie", sekcja „Co blokuje przejście dalej" (jeśli dotyczy). Bez zrzutów — dochodzą w Tasku 9. Bez treści metodycznej („dlaczego akurat tak") — to drzewo referencyjne, fala 2; w razie potrzeby zostaw zdanie „Szczegóły metody opisujemy w sekcji …" **bez linku** (linki dochodzą w Tasku 14, zasada zero martwych linków).

- [ ] **Step 2: Dopisz wpisy do manifestu**

Dla każdej strony wpis wg wzorca z Taska 2: `slug`, `title`, `tree: "jak-korzystac"`, `order`, `tags` (słowa, których użytkownik realnie szuka — np. `["RCN", "transakcje", "próba", "IQR"]`), `summary` (jedno zdanie), `load` ze statycznym importem.

- [ ] **Step 3: Uruchom testy i build**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run && cd ~/Development/wyceny-app && pnpm build --filter=web`
Expected: testy manifestu PASS (ładowalność wszystkich stron), build zielony, indeks raportuje 4 strony

- [ ] **Step 4: Commit i push**

```bash
cd ~/Development/wyceny-app && git add -A && git commit -m "docs: help content for first steps and wizard steps 1-3" && git push
```

---

### Task 8: Treść — kroki 4–7 i po zatwierdzeniu

**Files:**

- Create: `apps/web/src/content/pomoc/jak-korzystac/krok-4-cechy.mdx`
- Create: `apps/web/src/content/pomoc/jak-korzystac/krok-5-kalkulacja.mdx`
- Create: `apps/web/src/content/pomoc/jak-korzystac/krok-6-opisy.mdx`
- Create: `apps/web/src/content/pomoc/jak-korzystac/krok-7-operat.mdx`
- Create: `apps/web/src/content/pomoc/jak-korzystac/po-zatwierdzeniu.mdx`
- Modify: `apps/web/src/content/pomoc/manifest.ts`
- Modify: `apps/web/tests/rtl-step-header.test.tsx`

**Interfaces:**

- Consumes: manifest, konwencja stron z Taska 7
- Produces: komplet 9 stron drzewa „Jak korzystać" (`order` 1–9).

**Źródła do przeczytania przed pisaniem:** krok 4 → `src/domain/feature-presets.ts`; krok 5 → `src/domain/kcs.ts` (tylko opis działania z perspektywy użytkownika — wzory i zaokrąglenia należą do fali 2); krok 6 → `src/domain/operat-sections.ts`; krok 7 → `src/domain/document-model.ts`; po zatwierdzeniu → mechanika podpisu i niezmienności (F-7) w `src/app/actions/**` i `src/domain/valuation.ts`.

- [ ] **Step 1: Napisz treść pięciu stron**

Układ jak w Tasku 7.

- [ ] **Step 2: Dopisz wpisy do manifestu**

`order` 5–9, `tree: "jak-korzystac"`.

- [ ] **Step 3: Przepnij test negatywny StepHeadera**

Po tym tasku wszystkie siedem kroków ma stronę, więc przypadek „nie renderuje linku, gdy strona nie istnieje" nie ma już kroku bez strony. Zamień go na test jednostkowy warunku: wyrenderuj `StepHeader` z metadanymi zawierającymi `helpSlug` spoza manifestu (przez lokalny stub `STEP_META` albo bezpośrednie sprawdzenie predykatu) i potwierdź brak linku. **Nie usuwaj tego przypadku** — chroni zasadę zero martwych linków.

- [ ] **Step 4: Uruchom testy i build**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run && cd ~/Development/wyceny-app && pnpm build --filter=web`
Expected: PASS; indeks raportuje 9 stron; linki Pomocy działają we wszystkich siedmiu krokach

- [ ] **Step 5: Commit i push**

```bash
cd ~/Development/wyceny-app && git add -A && git commit -m "docs: help content for wizard steps 4-7 and post-approval" && git push
```

---

### Task 9: Zrzuty ekranu ze stagingu

**Files:**

- Create: `apps/web/public/pomoc/*.png`
- Modify: wszystkie dziewięć plików MDX drzewa „Jak korzystać"

**Interfaces:**

- Consumes: wdrożony staging (`https://wyceny-mu.vercel.app`), konto testowe
- Produces: zrzuty osadzone w treści; nazewnictwo `krok-N-<co>.png`, `lista-wycen.png`, `po-zatwierdzeniu-<co>.png`.

- [ ] **Step 1: Zaloguj się na staging i zweryfikuj konto**

Otwórz `https://wyceny-mu.vercel.app` w sterowanej przeglądarce i zaloguj się kontem testowym (poświadczenia **wyłącznie z sesji rozmowy — nie zapisuj ich do żadnego pliku**, F-9 skanuje repo). Jeśli konto nie działa: zasiej konto testowe przez `pnpm seed` (`apps/web/scripts/seed.ts` jest idempotentny) i użyj go.

- [ ] **Step 2: Zrób zrzuty**

Stała szerokość viewportu 1440 px dla wszystkich kadrów. Zestaw minimalny: lista wycen, każdy z siedmiu kroków kreatora (na wycenie z realnymi danymi — użyj istniejącego szkicu QA), widok zatwierdzonego operatu. Kadruj obszar treści, nie cały pulpit.

- [ ] **Step 3: Skompresuj i zapisz**

Zapisz do `apps/web/public/pomoc/`. Cel: pojedynczy plik poniżej ~300 KB. Zweryfikuj: `du -sh apps/web/public/pomoc/`.

- [ ] **Step 4: Osadź w treści**

W każdej stronie MDX wstaw zrzut pod akapitem wprowadzającym, standardowym `<img>` z `alt` opisującym ekran po polsku (dostępność) i szerokością 100%.

- [ ] **Step 5: Zweryfikuj build i wagę**

Run: `cd ~/Development/wyceny-app && pnpm build --filter=web && du -sh apps/web/public/pomoc/`
Expected: build zielony; katalog zrzutów w rozsądnych granicach (poniżej ~3 MB łącznie)

- [ ] **Step 6: Commit i push**

```bash
cd ~/Development/wyceny-app && git add -A && git commit -m "docs: staging screenshots embedded in help pages" && git push
```

---

> ## ⛔ CHECKPOINT (fala 1)
>
> Po Tasku 9: pełne przejście po `/pomoc` na stagingu — nawigacja, wyszukiwarka, dziewięć stron, trzy wejścia, zrzuty. **Użytkownik ocenia falę 1 przed rozpoczęciem treści metodycznej.** Uwagi z tej oceny wchodzą jako poprawki przed Taskiem 10.

---

# FALA 2 — metodyka

### Task 10: Wyodrębnienie stałych zaokrągleń z `computeKcs`

**Files:**

- Modify: `apps/web/src/domain/kcs.ts`
- Test: `apps/web/tests/kcs-rounding.test.ts` (rozszerzyć istniejący)

**Interfaces:**

- Consumes: nic
- Produces: eksportowane stałe `ROUNDING = { csr: 2, vmin: 3, vmax: 3, sumUi: 3, unitValue: 2, wrNearest: 100 } as const` — importowane przez stronę MDX `metoda-kcs` (Task 11). **Wartości muszą odpowiadać dzisiejszym literałom co do znaku.**

**To jedyna zmiana w kodzie domeny w całym slice'ie.** Czysto mechaniczna: literał → nazwana stała. Golden F-1 jest bramką — jeśli cokolwiek się przesunie, test padnie.

- [ ] **Step 1: Dopisz test pinujący stałe**

```ts
import { describe, expect, it } from "vitest";
import { ROUNDING } from "../kcs";

describe("ROUNDING", () => {
  it("odpowiada konwencji operatu (F-1)", () => {
    expect(ROUNDING).toEqual({ csr: 2, vmin: 3, vmax: 3, sumUi: 3, unitValue: 2, wrNearest: 100 });
  });
});
```

- [ ] **Step 2: Uruchom test — musi paść**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run tests/kcs-rounding.test.ts`
Expected: FAIL — brak eksportu `ROUNDING`

- [ ] **Step 3: Wyodrębnij stałe**

W `kcs.ts` dodaj eksport `ROUNDING` i zastąp literały w `computeKcs` odwołaniami (`roundTo(..., ROUNDING.csr)` itd.). Komentarz JSDoc opisujący konwencję **zostaw** — teraz odsyła do stałej zamiast powtarzać liczby.

- [ ] **Step 4: Uruchom pełny zestaw testów domeny**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run tests/golden-wr.test.ts tests/kcs-reproducibility.test.ts tests/kcs-rounding.test.ts`
Expected: PASS, w tym **golden F-1 = 1 044 400 zł**. Jakakolwiek zmiana goldena oznacza błąd refaktoru — cofnij i popraw, nie aktualizuj wartości oczekiwanej.

- [ ] **Step 5: Commit i push**

```bash
cd ~/Development/wyceny-app && git add -A && git commit -m "refactor: name the operat rounding constants for help citation" && git push
```

---

### Task 11: Treść metodyczna — metoda KCS i dobór próby

**Files:**

- Create: `apps/web/src/content/pomoc/metodyka/metoda-kcs.mdx`
- Create: `apps/web/src/content/pomoc/metodyka/dobor-proby-rcn.mdx`
- Modify: `apps/web/src/content/pomoc/manifest.ts`

**Interfaces:**

- Consumes: `ROUNDING` z `@/domain/kcs` (Task 10)
- Produces: dwie strony `tree: "metodyka"`, `order` 1–2.

**Wymóg evidence-based:** strona `metoda-kcs` **importuje** `ROUNDING` i renderuje wartości z niej — nie wpisuje liczb ręcznie. Strona `dobor-proby-rcn` cytuje stałe workera: `POOL_N = 19`, `AREA_BAND_PCT = 0.30`, `DATE_WINDOW_MONTHS = 24` (`apps/worker/app/rcn.py`) oraz adres rejestru; wartości utrzymywane po stronie web z komentarzem wskazującym plik źródłowy — **to jest znane ograniczenie R1 ze specu**, nie przeoczenie.

- [ ] **Step 1: Przeczytaj źródła**

`apps/web/src/domain/kcs.ts` w całości oraz `apps/worker/app/rcn.py` w całości. Treść ma odpowiadać temu, co kod **robi**, nie temu, co obiecuje komentarz.

- [ ] **Step 2: Napisz `metoda-kcs.mdx`**

Zakres: czym jest korygowanie ceny średniej, skąd bierze się cena średnia, czym są współczynniki Vmin/Vmax, jak sumują się wagi cech, jak powstaje wartość jednostkowa i wartość rynkowa. Osobna sekcja o konwencji zaokrągleń z wartościami z `ROUNDING` i wyjaśnieniem, **dlaczego operat daje 1 044 400 zł, a pełna precyzja dałaby 1 043 900 zł** — to najważniejszy akapit całej Pomocy.

- [ ] **Step 3: Napisz `dobor-proby-rcn.mdx`**

Zakres: czym jest rejestr RCN, jak duża jest pobierana pula, pasmo metrażu, okno czasowe, filtr sanity dat (z realnym przykładem daty typu `5201-07`), przycinanie IQR, próg 12 transakcji i co się dzieje przy mniejszej liczbie. Każda liczba opatrzona wskazaniem, skąd pochodzi.

- [ ] **Step 4: Dopisz wpisy do manifestu i zweryfikuj**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run && cd ~/Development/wyceny-app && pnpm build --filter=web`
Expected: PASS, indeks raportuje 11 stron

- [ ] **Step 5: Commit i push**

```bash
cd ~/Development/wyceny-app && git add -A && git commit -m "docs: methodology pages for kcs method and rcn sampling" && git push
```

---

### Task 12: Treść metodyczna — źródła danych i ekstrakcja dokumentów

**Files:**

- Create: `apps/web/src/content/pomoc/metodyka/zrodla-danych-przedmiotu.mdx`
- Create: `apps/web/src/content/pomoc/metodyka/ekstrakcja-kw-akt.mdx`
- Modify: `apps/web/src/content/pomoc/manifest.ts`

**Interfaces:**

- Consumes: manifest
- Produces: dwie strony `tree: "metodyka"`, `order` 3–4.

**Źródła do przeczytania:** `apps/worker/app/subject.py` (geokoder, EGiB, MPZP, przecięcia), `apps/worker/app/kw.py` (ekstrakcja z dokumentów), `apps/worker/app/maps.py` (mapy).

- [ ] **Step 1: Napisz `zrodla-danych-przedmiotu.mdx`**

Zakres: z jakich rejestrów publicznych pochodzą dane (nazwy i adresy usług ze stałych workera), co dokładnie pobieramy o działce i budynku, jak ustalamy przeznaczenie w planie miejscowym i **co się dzieje, gdy planu nie ma** (przypadek dotyczący około połowy Poznania), skąd biorą się mapy w operacie, oraz ograniczenie zasięgu terytorialnego.

- [ ] **Step 2: Napisz `ekstrakcja-kw-akt.mdx`**

Zakres: jakie dokumenty przyjmujemy, co z nich wyciągamy, czego **nie** wyciągamy, jak traktujemy dane wrażliwe (maskowanie), limit rozmiaru pliku, oraz zasada, że wynik ekstrakcji jest **propozycją do potwierdzenia**, nie faktem.

- [ ] **Step 3: Dopisz wpisy do manifestu i zweryfikuj**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run && cd ~/Development/wyceny-app && pnpm build --filter=web`
Expected: PASS, indeks raportuje 13 stron

- [ ] **Step 4: Commit i push**

```bash
cd ~/Development/wyceny-app && git add -A && git commit -m "docs: methodology pages for subject data sources and document extraction" && git push
```

---

### Task 13: Treść metodyczna — zatwierdzanie, operat i niezmienność

**Files:**

- Create: `apps/web/src/content/pomoc/metodyka/zasady-zatwierdzania.mdx`
- Create: `apps/web/src/content/pomoc/metodyka/operat-i-niezmiennosc.mdx`
- Modify: `apps/web/src/content/pomoc/manifest.ts`

**Interfaces:**

- Consumes: manifest
- Produces: dwie strony `tree: "metodyka"`, `order` 5–6; komplet 15 stron w obu drzewach.

**Źródła do przeczytania:** `src/domain/provenance.ts` i `src/domain/valuation.ts` (brama F-4, prowenancja), `src/domain/document-model.ts` i `src/domain/operat-sections.ts` (struktura operatu), mechanika audytu i podpisu (F-7).

- [ ] **Step 1: Napisz `zasady-zatwierdzania.mdx`**

Zakres: czym jest prowenancja wartości, różnica między wpisem ręcznym a propozycją ze źródła zewnętrznego, **pełna lista warunków blokujących zatwierdzenie**, dlaczego brama działa po stronie serwera i czego to chroni.

- [ ] **Step 2: Napisz `operat-i-niezmiennosc.mdx`**

Zakres: z czego składa się wygenerowany operat, co się dzieje w chwili zatwierdzenia, na czym polega niezmienność (write-once, suma kontrolna), co zapisuje dziennik audytu, jak działa podpis i co oznacza dla rzeczoznawcy.

- [ ] **Step 3: Dopisz wpisy do manifestu i zweryfikuj**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run && cd ~/Development/wyceny-app && pnpm build --filter=web`
Expected: PASS, indeks raportuje **15 stron**

- [ ] **Step 4: Commit i push**

```bash
cd ~/Development/wyceny-app && git add -A && git commit -m "docs: methodology pages for approval rules and operat immutability" && git push
```

---

### Task 14: Odsłonięcie drzewa metodycznego i linki krzyżowe

**Files:**

- Modify: dziewięć plików MDX drzewa „Jak korzystać"
- Modify: `apps/web/tests/rtl-help-nav.test.tsx`

**Interfaces:**

- Consumes: komplet 15 stron
- Produces: linki z instrukcji do odpowiadających stron metodycznych; notka „wkrótce" znika samoczynnie (drzewo ma już strony) — test z Taska 3 wymaga przepięcia.

- [ ] **Step 1: Przepnij test notki**

Przypadek „pokazuje notkę zamiast pustej listy" nie ma już zastosowania na realnym manifeście. Przepisz go tak, by testował samą funkcję renderującą przy pustej liście stron (wstrzyknięta pusta tablica), a nie stan globalnego manifestu. **Nie usuwaj przypadku.**

- [ ] **Step 2: Dodaj linki krzyżowe**

W stronach instrukcji zamień zdania „Szczegóły metody opisujemy w sekcji …" (Task 7/8) na realne linki do stron metodycznych. Minimum: krok 3 → `dobor-proby-rcn`, krok 5 → `metoda-kcs`, krok 1 → `zrodla-danych-przedmiotu`, krok 7 i po-zatwierdzeniu → `operat-i-niezmiennosc`.

- [ ] **Step 3: Uruchom testy i build**

Run: `cd ~/Development/wyceny-app/apps/web && pnpm vitest run && cd ~/Development/wyceny-app && pnpm build --filter=web`
Expected: PASS

- [ ] **Step 4: Commit i push**

```bash
cd ~/Development/wyceny-app && git add -A && git commit -m "docs: reveal methodology tree and cross-link from how-to pages" && git push
```

---

### Task 15: QA na stagingu

**Files:**

- Create: `.superpowers/sdd/pomoc-qa-report.md`

**Interfaces:**

- Consumes: wdrożony staging po Tasku 14
- Produces: raport QA — wejście do checkpointu użytkownika i materiał do strony wiki (S6).

- [ ] **Step 1: Przejdź pełną ścieżkę na stagingu**

Zaloguj się i sprawdź: `/pomoc` bez sesji przekierowuje na login; nawigacja pokazuje oba drzewa z 15 stronami; wyszukiwarka znajduje frazę z treści (nie z tytułu) — np. „IQR" i „plan miejscowy"; wyszukiwarka radzi sobie z polskimi znakami; wszystkie 15 stron otwiera się bez błędu; znak zapytania działa w każdym z siedmiu kroków i prowadzi do właściwej strony; linki krzyżowe działają; zrzuty się ładują.

- [ ] **Step 2: Zweryfikuj wymóg evidence-based empirycznie**

Sprawdź, że strona `metoda-kcs` pokazuje wartości zgodne z `ROUNDING` w kodzie. Wykonaj próbę: lokalnie zmień jedną wartość w `ROUNDING`, uruchom `pnpm build --filter=web`, potwierdź, że treść Pomocy się zmieniła, **cofnij zmianę**. To jest dowód, że treść jest wyprowadzona z kodu, a nie przepisana.

- [ ] **Step 3: Potwierdź brak regresji**

Run: `cd ~/Development/wyceny-app && pnpm test && pnpm lint && pnpm typecheck && pnpm depcruise`
Expected: wszystko zielone. Sprawdź CI na ostatnim pushu. Zweryfikuj, że **golden F-1 = 1 044 400 zł** jest w raporcie testów.

- [ ] **Step 4: Spisz raport**

`.superpowers/sdd/pomoc-qa-report.md`: wyniki wszystkich kontroli z kroków 1–3, znalezione usterki z decyzją (naprawione teraz / odłożone), lista 15 stron z potwierdzeniem otwarcia.

- [ ] **Step 5: Commit i push**

```bash
cd ~/Development/wyceny-app && git add -A && git commit -m "test: staging qa report for help module" && git push
```

---

> ## ⛔ CHECKPOINT (fala 2)
>
> Użytkownik ocenia komplet Pomocy na stagingu. Dopiero po akceptacji — S6 (dokumentacja w wiki) i S7.

---

### Task 16: S7 — krok anty-dryfowy w skillu `build-slice`

**Files:**

- Modify: `~/Development/wyceny/.claude/skills/build-slice/references/docs-update-checklist.md`

**Interfaces:**

- Consumes: nic
- Produces: stały krok w rytuale po-slice'owym. **To jedyny mechanizm chroniący Pomoc przed dryfem** — dlatego S7 jest w tym slice'ie obowiązkowy, nie opcjonalny.

- [ ] **Step 1: Dopisz krok do checklisty**

Dodaj pozycję: _„**Moduł Pomoc** — czy ten slice zmienił coś, co Pomoc opisuje (ekrany, przepływy, stałe, źródła danych, reguły zatwierdzania)? Jeśli tak: zaktualizuj odpowiednie strony MDX w `apps/web/src/content/pomoc/`, odśwież dotknięte zrzuty ze stagingu i wypisz zmienione strony w raporcie slice'a. Jeśli nie — napisz wprost, że sprawdzono i nie było zmian."_

Uzasadnienie do zapisania obok kroku: mechanizm wpięty w rytuał utrzymuje się sam (docs-loop wykonany 9/9 razy), osobna dyscyplina nie (cotygodniowy lint: 0/12).

- [ ] **Step 2: Commit (wiki repo, wymaga zgody użytkownika)**

```bash
cd ~/Development/wyceny && git add .claude/skills/build-slice/references/docs-update-checklist.md
git commit -m "docs: build-slice S6 — krok aktualizacji modulu Pomoc"
```

---

## Podsumowanie

| Task  | Deliverable                         | Weryfikacja                               |
| ----- | ----------------------------------- | ----------------------------------------- |
| 1     | MDX + trasa `/pomoc` za logowaniem  | 2 testy + build                           |
| 2     | manifest + renderer `[slug]`        | 4 testy (w tym ładowalność każdej strony) |
| 3     | nawigacja dwóch drzew               | 3 testy RTL                               |
| 4     | indeks + wyszukiwarka pełnotekstowa | 6 testów jednostkowych + 2 RTL            |
| 5     | wejście z menu awatara              | test RTL                                  |
| 6     | wejście ze StepHeadera (7 kroków)   | 2 testy RTL                               |
| 7–8   | 9 stron „Jak korzystać"             | testy manifestu + build                   |
| 9     | zrzuty ze stagingu                  | build + kontrola wagi                     |
| —     | **⛔ checkpoint fali 1**            | ocena użytkownika                         |
| 10    | stałe `ROUNDING` w `kcs.ts`         | test pinujący + **golden F-1**            |
| 11–13 | 6 stron metodycznych                | testy manifestu + build                   |
| 14    | odsłonięcie drzewa + linki krzyżowe | testy RTL                                 |
| 15    | QA na stagingu                      | raport + dowód evidence-based             |
| —     | **⛔ checkpoint fali 2**            | ocena użytkownika                         |
| 16    | S7 — krok anty-dryfowy              | zmiana w skillu                           |

**Po checkpointcie fali 2:** S6 — dokumentacja w wiki (log, timeline, strona `wiki/topics/tech/modul-pomoc-slice.md`, roadmapa NOW→DONE, promocja kolejnej pozycji, index), zgodnie z `references/docs-update-checklist.md`.
