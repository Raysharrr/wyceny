import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/auth/session";
import { profileRepository } from "@/app/valuations/_deps";
import { SignatureForm } from "./signature-form";

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const signature = await profileRepository.getSignature(session.user.id);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Profil rzeczoznawcy</h1>
        <Link href="/valuations" className="text-sm underline">
          ← Wyceny
        </Link>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Podpis do operatu</h2>
        {signature ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL, next/image adds nothing
          <img
            alt="Aktualny skan podpisu"
            className="max-h-24 w-fit rounded border bg-white p-2"
            src={`data:${signature.mime};base64,${signature.bytes.toString("base64")}`}
          />
        ) : null}
        <SignatureForm hasSignature={Boolean(signature)} />
      </section>
    </main>
  );
}
