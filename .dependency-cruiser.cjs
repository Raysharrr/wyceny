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
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
