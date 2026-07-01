import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";

// Root entry point: send signed-in users to their wyceny, everyone else to login.
export default async function Home() {
  const session = await getSession();
  redirect(session ? "/wyceny" : "/login");
}
