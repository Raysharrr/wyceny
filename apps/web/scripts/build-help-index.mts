import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { HELP_PAGES } from "../src/content/pomoc/manifest";
import { stripMdx, type HelpIndexEntry } from "../src/lib/help-search";

/**
 * Builds `src/content/pomoc/search-index.json` from the MDX files + manifest
 * (Slice 13, Task 4). Run from `prebuild`/`predev`/`pretypecheck`/`pretest` —
 * the artefact is gitignored, so every consumer has to be able to regenerate
 * it from a clean clone.
 *
 * TypeScript rather than `.mjs` on purpose: the search functions are shared
 * with the browser component, and a `.mjs` module imported from a `.ts` test
 * passes vitest but fails `tsc --noEmit` on the missing declarations. `tsx` is
 * already a dependency (it runs `pnpm seed`).
 *
 * `.mts`, not `.ts`: `apps/web/package.json` has no `"type": "module"`, so tsx
 * compiles a plain `.ts` to CJS — where both `import.meta.dirname` and the
 * top-level `await` below are unavailable (esbuild: "Top-level await is
 * currently not supported with the cjs output format"). tsconfig's `include`
 * already covers `.mts`, and no test imports this script.
 */
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
    // A page present as a file but absent from the manifest would surface in
    // search results and 404 on click — a ghost page is worse than no page,
    // so the build stops here. dependency-cruiser can't catch this (no
    // `no-unresolved` rule), and neither can the type checker.
    if (!page) {
      throw new Error(`Plik ${slug}.mdx nie ma wpisu w manifest.ts — dodaj wpis albo usun plik.`);
    }
    index.push({
      slug,
      title: page.title,
      tree: page.tree,
      tags: page.tags,
      text: stripMdx(await readFile(file, "utf8")),
    });
    bySlug.delete(slug);
  }

  // The mirror image: a manifest entry with no file renders an empty page and
  // links to it from the nav. Same verdict — stop the build.
  if (bySlug.size > 0) {
    throw new Error(
      `Manifest wymienia strony bez pliku MDX: ${[...bySlug.keys()].join(", ")} — dodaj plik albo usun wpis.`,
    );
  }

  await writeFile(OUT, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  console.log(`search-index.json: ${index.length} stron`);
};

await main();
