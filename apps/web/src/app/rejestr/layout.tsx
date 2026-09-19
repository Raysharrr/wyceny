/**
 * App chrome for the office tools (T-13 `/rejestr/*`, extended T-22): the shared
 * session-fetch + Topbar. The tool switcher is deliberately NOT here — each page
 * renders `<ToolsNav />` as the first child of its OWN container, so the pills
 * line up with that page's heading whatever its width (review 1 R1:
 * `/rejestr/transakcja` is `max-w-[1024px]`, the rest `max-w-[1240px]`).
 * `/narzedzia` re-exports this same layout.
 */
export { AppShellLayout as default } from "@/components/app-shell-layout";
