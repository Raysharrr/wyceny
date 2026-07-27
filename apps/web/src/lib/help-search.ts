import type { HelpPage, HelpTree } from "@/content/pomoc/manifest";

/**
 * One row of the generated search index (Slice 13, Task 4). Produced by
 * `scripts/build-help-index.ts`, consumed by `<HelpSearch />`.
 */
export type HelpIndexEntry = {
  slug: string;
  title: string;
  tree: HelpTree;
  tags: string[];
  text: string;
};

/**
 * Strips MDX syntax down to the prose worth indexing. Code fences go first —
 * they routinely contain `import`/`export` lines and angle brackets that the
 * later passes would otherwise turn into noise words.
 */
export const stripMdx = (source: string): string =>
  source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^import .*$/gm, " ")
    .replace(/^export .*$/gm, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_>`|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * One MDX file as handed to `buildIndex`: `slug` derived from the filename,
 * `file` its path relative to the content root (error messages only), `text`
 * the raw source — `stripMdx` runs inside `buildIndex`, so the calling script
 * stays pure I/O.
 */
export type HelpSourceFile = { slug: string; file: string; text: string };

/**
 * Joins the MDX files with the manifest and refuses anything inconsistent.
 * Lives here rather than inline in `scripts/build-help-index.mts` for one
 * reason: nothing imports a `.mts` build script, so the guard had zero test
 * coverage — an independent review deleted both `throw`s and the whole suite
 * stayed green. Same lesson as `sortPages` in the manifest.
 *
 * A file with no manifest entry would surface in search results and 404 on
 * click; a manifest entry with no file renders an empty page that the nav
 * links to. Both are worse than a failed build, and neither is catchable by
 * the type checker or dependency-cruiser (no `no-unresolved` rule).
 *
 * The duplicate pass runs first on purpose. Slugs come from the bare filename,
 * so `jak-korzystac/zaokraglenia.mdx` and `metodyka/zaokraglenia.mdx` collide;
 * without this pass the second file falls into the "no manifest entry" branch
 * (the entry was already consumed by the first) and the message sends the
 * author looking for a manifest bug that isn't there.
 */
export const buildIndex = (files: HelpSourceFile[], pages: HelpPage[]): HelpIndexEntry[] => {
  const fileBySlug = new Map<string, string>();
  for (const { slug, file } of files) {
    const first = fileBySlug.get(slug);
    if (first !== undefined) {
      throw new Error(
        `Pliki ${first} i ${file} daja ten sam slug "${slug}" — nazwa pliku MDX musi byc unikalna w calej Pomocy.`,
      );
    }
    fileBySlug.set(slug, file);
  }

  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  const index = files.map(({ slug, text }) => {
    const page = bySlug.get(slug);
    if (!page) {
      throw new Error(`Plik ${slug}.mdx nie ma wpisu w manifest.ts — dodaj wpis albo usun plik.`);
    }
    return { slug, title: page.title, tree: page.tree, tags: page.tags, text: stripMdx(text) };
  });

  const bezPliku = pages.filter((page) => !fileBySlug.has(page.slug)).map((page) => page.slug);
  if (bezPliku.length > 0) {
    throw new Error(
      `Manifest wymienia strony bez pliku MDX: ${bezPliku.join(", ")} — dodaj plik albo usun wpis.`,
    );
  }

  return index;
};

/**
 * Folds case and diacritics so "ksiega" finds „Księga". NFD + `\p{Diacritic}`
 * handles ą/ć/ę/ń/ó/ś/ź/ż, but NOT ł/Ł — those are their own Unicode letters
 * with no combining mark to strip, hence the explicit pair.
 */
export const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase();

/**
 * Substring match over title + body + tags, order preserved from the index
 * (i.e. manifest order). An empty query returns nothing rather than
 * everything: `"".includes` matches every entry, which would dump the whole
 * Pomoc list under the box the moment it takes focus.
 */
export const searchIndex = (index: HelpIndexEntry[], query: string): HelpIndexEntry[] => {
  const needle = normalize(query).trim();
  if (!needle) return [];
  return index.filter((entry) =>
    normalize([entry.title, entry.text, entry.tags.join(" ")].join(" ")).includes(needle),
  );
};
