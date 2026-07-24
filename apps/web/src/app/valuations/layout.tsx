import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Topbar } from "@/components/topbar";
import { getSession } from "@/auth/session";
import { signOutAction } from "@/app/actions/sign-out";

const ROLE_LABEL = { appraiser: "rzeczoznawca", admin: "administrator" } as const;

/**
 * App chrome for `/valuations`, `/valuations/new`, `/valuations/[id]`
 * (Task 3). Renders the sticky Topbar with the session user; "Profil" and
 * "Wyloguj" moved here (advisor I5) so they appear on all three pages
 * instead of only the list's action row.
 */
export default async function ValuationsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    // No Topbar without a session — pages keep their own redirect behavior.
    return <>{children}</>;
  }
  return (
    <>
      <Topbar userName={session.user.name} userRole={ROLE_LABEL[session.user.role]}>
        <Button asChild variant="outline">
          <Link href="/profile">Profil</Link>
        </Button>
        <form action={signOutAction}>
          <Button type="submit" variant="outline">
            Wyloguj
          </Button>
        </form>
      </Topbar>
      {children}
    </>
  );
}
