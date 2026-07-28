import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ships the DOCX operat template with the serverless bundle for the
  // route that renders it (Task 4: docx-render adapter, F-12).
  //
  // Same deal for the Pomoc screenshots: they live outside `public/` so that
  // only `/api/pomoc/[name]` can hand them out (Slice 13 follow-up), which
  // means the bundler never sees an import for them — read at runtime via
  // `fs`, they would simply be missing on Vercel without this entry.
  outputFileTracingIncludes: {
    "/valuations/[id]": ["./templates/**"],
    "/api/pomoc/[name]": ["./src/content/pomoc/img/**"],
  },
};

// Help content lives in `.mdx` files under `src/content/pomoc/` (Slice 13).
// `pageExtensions` stays untouched on purpose — MDX is imported content, not
// routes. `createMDX` wires the loader for both webpack and Turbopack and
// resolves the component map from `src/mdx-components.tsx`.
const withMDX = createMDX({});

export default withMDX(nextConfig);
