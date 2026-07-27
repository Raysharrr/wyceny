import type { HelpTree } from "@/content/pomoc/manifest";

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
