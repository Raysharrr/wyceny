import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect("/valuations");
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-secondary/40 px-4 py-16">
      <LoginForm />
    </div>
  );
}
