/**
 * App chrome for `/pomoc` — same Topbar + session wiring as `/valuations`
 * and `/profile`. The layout itself does not gate access; each page keeps
 * its own `getSession()` + `redirect` (Slice 13, Task 1).
 */
export { AppShellLayout as default } from "@/components/app-shell-layout";
