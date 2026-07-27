import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ships the DOCX operat template with the serverless bundle for the
  // route that renders it (Task 4: docx-render adapter, F-12).
  outputFileTracingIncludes: {
    "/valuations/[id]": ["./templates/**"],
  },
};

// Help content lives in `.mdx` files under `src/content/pomoc/` (Slice 13).
// `pageExtensions` stays untouched on purpose — MDX is imported content, not
// routes. `createMDX` wires the loader for both webpack and Turbopack and
// resolves the component map from `src/mdx-components.tsx`.
const withMDX = createMDX({});

export default withMDX(nextConfig);
