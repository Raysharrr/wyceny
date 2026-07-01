const path = require("node:path");

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-domain-importing-adapters",
      comment:
        "F-10 dependency rule: apps/web/src/domain/** is pure business logic. " +
        "It may depend on ports/ (type-level contracts) but never on a concrete " +
        "adapter, the db client, or a framework/db package directly.",
      severity: "error",
      from: { path: "^apps/web/src/domain" },
      to: {
        path: [
          "^apps/web/src/adapters",
          "^apps/web/src/db",
          "node_modules/(drizzle-orm|pg|next|better-auth)($|/)",
        ],
      },
    },
    {
      name: "no-shared-importing-adapters",
      comment:
        "F-10 dependency rule: packages/shared is the pure kernel used across " +
        "apps. It must never depend on apps/web's adapters, db client, or " +
        "framework/db packages.",
      severity: "error",
      from: { path: "^packages/shared/src" },
      to: {
        path: [
          "^apps/web/src/adapters",
          "^apps/web/src/db",
          "node_modules/(drizzle-orm|pg|next|better-auth)($|/)",
        ],
      },
    },
    {
      name: "adapters-wired-only-at-app-layer",
      comment:
        "F-10 dependency rule: apps/web/src/adapters/** (concrete infra — " +
        "Postgres, HTTP worker client, file storage) may only be imported " +
        "from apps/web/src/app/** (the composition-root/app layer — e.g. " +
        "`_deps.ts`, the `/api/docs` route). Everything else under src/ " +
        "(domain, ports, components, auth, db-schema types, ...) must go " +
        "through the port contracts instead of reaching for a concrete " +
        "adapter directly. `from.pathNot` also excludes adapters/** itself " +
        "so adapters remain free to depend on one another — this rule is " +
        "about *consumers* of adapters, not the adapters' own internals. " +
        "Relies on `options.tsConfig` below to resolve `@/`-alias imports " +
        "(e.g. `_deps.ts`'s `@/adapters/...`) to their real path — without " +
        "it, alias imports aren't followed and this rule would silently " +
        "check nothing.",
      severity: "error",
      from: { path: "^apps/web/src", pathNot: ["^apps/web/src/app", "^apps/web/src/adapters"] },
      to: { path: "^apps/web/src/adapters" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      // MUST be absolute: dependency-cruiser's tsConfig loader resolves
      // `include`/`exclude` against `dirname(resolve(fileName))`, then
      // re-derives paths from the (still-relative) `fileName` a second
      // time internally — with a relative fileName the two resolutions
      // compound into a doubled path (".../apps/web/apps/web"), so every
      // `include` glob matches zero files and TS throws TS18003 ("No
      // inputs were found"). An absolute path sidesteps the doubling.
      fileName: path.join(__dirname, "apps/web/tsconfig.json"),
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
