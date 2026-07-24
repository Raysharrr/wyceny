import { Topbar } from "@/components/topbar";
import { getSession } from "@/auth/session";

const ROLE_LABEL = { appraiser: "rzeczoznawca", admin: "administrator" } as const;

/**
 * Shared app chrome: fetches the session and renders the sticky `Topbar`
 * above `children` (Task 3, extracted as a shared helper in Task 15 so
 * `/valuations/*` and `/profile` don't each duplicate the session-fetch +
 * Topbar wiring). Both `valuations/layout.tsx` and `profile/layout.tsx`
 * re-export this directly as their default layout export.
 */
export async function AppShellLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    // No Topbar without a session — pages keep their own redirect behavior.
    return <>{children}</>;
  }
  return (
    <>
      <Topbar
        userName={session.user.name}
        userEmail={session.user.email}
        userRole={ROLE_LABEL[session.user.role]}
      />
      {children}
    </>
  );
}
