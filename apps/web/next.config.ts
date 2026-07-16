import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ships the DOCX operat template with the serverless bundle for the
  // route that renders it (Task 4: docx-render adapter, F-12).
  outputFileTracingIncludes: {
    "/valuations/[id]": ["./templates/**"],
  },
};

export default nextConfig;
