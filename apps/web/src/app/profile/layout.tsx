/**
 * App chrome for `/profile` (Task 15) — `/profile` isn't nested under
 * `/valuations`, so it needs its own layout to get the Topbar (with the
 * avatar dropdown's "Profil i ustawienia" link now pointing here). Reuses
 * the exact same session-fetch + Topbar wiring as `valuations/layout.tsx`
 * via the shared `AppShellLayout` (no behavior difference, so no copy).
 */
export { AppShellLayout as default } from "@/components/app-shell-layout";
