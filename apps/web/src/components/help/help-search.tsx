"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TREE_LABEL } from "@/content/pomoc/manifest";
import { searchIndex, type HelpIndexEntry } from "@/lib/help-search";

/**
 * Full-text search over Pomoc (Slice 13, Task 4). Filters the generated index
 * client-side — it is a handful of kilobytes, so a round trip per keystroke
 * would buy nothing.
 *
 * Accessibility, deliberately: the block is a `search` landmark and its
 * results carry NO heading. The page's heading outline (h1 „Pomoc" + one h2
 * per content tree) describes the permanent structure; a heading that
 * materialises and vanishes while typing would reshuffle that outline
 * mid-interaction. Landmark navigation reaches the box instead, and the
 * `status` region below announces the outcome.
 *
 * The status region is rendered unconditionally, with only its text
 * switching. A live region that enters the DOM together with its first
 * content is routinely missed by screen readers — the announcement has to
 * land in a region that was already there.
 */
export function HelpSearch({ index }: { index: HelpIndexEntry[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchIndex(index, query), [index, query]);
  const asked = query.trim().length > 0;

  return (
    <div role="search" className="mt-8">
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
      <p role="status" aria-live="polite" className="mt-3 text-[14px] text-muted-foreground">
        {asked ? (results.length === 0 ? "Brak wyników." : `Znaleziono ${results.length}.`) : ""}
      </p>
      {asked && results.length > 0 && (
        <ul className="mt-2 space-y-2">
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
