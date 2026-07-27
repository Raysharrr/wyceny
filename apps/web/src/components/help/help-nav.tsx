import Link from "next/link";
import { TREE_LABEL, pagesInTree, type HelpPage, type HelpTree } from "@/content/pomoc/manifest";

const TREES: HelpTree[] = ["jak-korzystac", "metodyka"];

/**
 * One tree's listing (Slice 13, Task 3). Exported separately so the
 * empty-tree branch is testable by injection: Task 14 fills `metodyka`, and a
 * test asserting "the second tree of the live manifest is empty" would then go
 * red for the wrong reason. The branch itself stays — it is what a reader sees
 * for any tree added ahead of its content.
 */
export function HelpTreeSection({ label, pages }: { label: string; pages: HelpPage[] }) {
  return (
    <section>
      <h2 className="mb-3 text-[16px] font-semibold">{label}</h2>
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
}

/** Both content trees of Pomoc, ordered by the manifest. */
export function HelpNav() {
  return (
    <div className="mt-8 grid gap-8 md:grid-cols-2">
      {TREES.map((tree) => (
        <HelpTreeSection key={tree} label={TREE_LABEL[tree]} pages={pagesInTree(tree)} />
      ))}
    </div>
  );
}
