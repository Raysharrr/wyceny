import type { MDXComponents } from "mdx/types";

/**
 * Required by `@next/mdx` in the App Router — it resolves
 * `next-mdx-import-source-file` to this module, so every `.mdx` file rendered
 * anywhere in the app picks up these components. Keeps Pomoc's typography in
 * one place instead of per-page classes (Slice 13, Task 1).
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h2: (props) => <h2 className="mt-8 mb-3 text-[19px] font-semibold" {...props} />,
    h3: (props) => <h3 className="mt-6 mb-2 text-[16px] font-semibold" {...props} />,
    p: (props) => <p className="mb-4 max-w-[70ch] text-[14.5px] leading-relaxed" {...props} />,
    ul: (props) => <ul className="mb-4 ml-5 list-disc space-y-1 text-[14.5px]" {...props} />,
    ol: (props) => <ol className="mb-4 ml-5 list-decimal space-y-1 text-[14.5px]" {...props} />,
    // Tailwind's preflight resets anchors to `color: inherit; text-decoration:
    // inherit`, so a markdown link inside MDX renders indistinguishable from
    // the surrounding prose (Slice 13, Task 14 — first task to put links in
    // content). Plain `<a>`, not `next/link`: MDX types `href` as optional, so
    // Link would need a narrowing wrapper — and a full page load is an
    // acceptable trade on a docs page. Styling matches `flat-view.tsx`.
    a: (props) => <a className="underline underline-offset-4 hover:text-primary" {...props} />,
    ...components,
  };
}
