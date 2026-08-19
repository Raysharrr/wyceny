import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // F-13: the allowlist is only a gate if it cannot be bypassed. A bare
    // console.* would put an unfiltered object straight into the log.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/log.ts"],
    rules: { "no-console": "error" },
  },
]);

export default eslintConfig;
