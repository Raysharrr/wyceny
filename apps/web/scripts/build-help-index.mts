import { readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { HELP_PAGES } from "../src/content/pomoc/manifest";
import { buildIndex } from "../src/lib/help-search";

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
  // The manifest<->files consistency gate lives in `buildIndex` (src/lib), not
  // here: nothing imports a `.mts` script, so a guard written inline would be
  // untestable — and was, until an independent review deleted both `throw`s
  // without turning the suite red.
  const index = buildIndex(
    await Promise.all(
      files.map(async (file) => ({
        slug: path.basename(file, ".mdx"),
        file: path.relative(CONTENT, file),
        text: await readFile(file, "utf8"),
      })),
    ),
    HELP_PAGES,
  );

  // Write to a private temp file, then `rename` over the target. `writeFile`
  // is open(O_TRUNC) + write, which leaves the file empty for as long as the
  // write takes — and turbo runs `build`, `typecheck` and `test` in parallel
  // (turbo.json wires none of them to `web#build`), so three generators race
  // here while tsc/vitest/next read the result. Measured on this repo: 160 of
  // 175 606 reads saw a zero-byte file, i.e. `SyntaxError: Unexpected end of
  // JSON input` at random in CI. `rename` within one directory is atomic, so
  // a reader sees either the previous index or the new one, never a torn one.
  // The pid keeps the three writers off each other's temp file.
  const tmp = `${OUT}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    await rename(tmp, OUT);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
  console.log(`search-index.json: ${index.length} stron`);
};

await main();
