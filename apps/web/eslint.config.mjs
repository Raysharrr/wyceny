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
    ignores: [
      "src/lib/log.ts",
      // Client components: their console.* runs in the BROWSER, where pino
      // (a Node logger) and AsyncLocalStorage do not exist, and where nothing
      // reaches our log sinks anyway — so they fall outside what this rule
      // guards. It guards SERVER logs against unfiltered payloads; data already
      // on the appraiser's own screen is not that threat. Their catch blocks
      // carry real signal the server never sees (a request that never left the
      // browser), so silencing them would lose the only trace of that failure.
      // A NEW client component with console.* must be added here deliberately.
      // NB `*` not `[id]`: eslint reads the path as a glob, where `[id]`
      // is a character class matching one of i/d — it would never match the
      // real directory.
      "src/app/valuations/*/steps/step-descriptions.tsx",
      "src/app/valuations/*/steps/operat-preview.tsx",
    ],
    rules: { "no-console": "error" },
  },
]);

export default eslintConfig;
