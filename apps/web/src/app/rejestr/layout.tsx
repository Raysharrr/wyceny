import type { ReactNode } from "react";
import { AppShellLayout } from "@/components/app-shell-layout";
import { ToolsNav } from "@/components/tools-nav";

/**
 * App chrome for the office tools (T-13 `/rejestr/*`, extended T-22): the shared
 * session-fetch + Topbar, plus the tool switcher above the page. `/narzedzia`
 * re-exports this same layout, so both tool trees get the identical shell.
 */
export default function ToolsLayout({ children }: { children: ReactNode }) {
  return (
    <AppShellLayout>
      <ToolsNav />
      {children}
    </AppShellLayout>
  );
}
