import { AppShellLayout } from "@/components/app-shell-layout";
import { ToolsNav } from "@/components/tools-nav";

/** App chrome + zakładki Narzędzi — layout każdej trasy, która jest narzędziem (`/narzedzia`, `/rejestr/*`). */
export function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShellLayout>
      <ToolsNav />
      {children}
    </AppShellLayout>
  );
}
