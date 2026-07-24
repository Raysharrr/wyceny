import { redirect } from "next/navigation";
import Link from "next/link";
import { PenLine } from "lucide-react";
import { getSession } from "@/auth/session";
import { profileRepository } from "@/app/valuations/_deps";
import { SectionCard } from "@/components/wizard/section-card";
import { SignatureForm } from "./signature-form";

/**
 * Restyled to the makieta's "Profil i ustawienia" screen shell (page-head +
 * SectionCard, Task 15) — the wizard's `max-w-[1240px]` outer width, a
 * narrower `max-w-2xl` column for the single card. Only the content that
 * already existed (the signature section) is restyled; the mockup's office
 * data / weights / grade-scale fields are separate, unbuilt features and
 * are deliberately not added here.
 */
export default async function ProfilePage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const signature = await profileRepository.getSignature(session.user.id);

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-4 px-6 py-10">
      <div className="max-w-2xl">
        <div className="mb-5">
          <Link
            href="/valuations"
            className="mb-3.5 inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            ← Wróć do wycen
          </Link>
          <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.06em] text-[var(--accent-700)]">
            Konto biura / profil i ustawienia
          </p>
          <h1 className="mb-1.5 text-[25px] font-semibold tracking-[-0.015em]">
            Profil i ustawienia
          </h1>
          <p className="max-w-[70ch] text-[14.5px] text-muted-foreground">
            Dane autora operatu oraz podpis, który pojawia się w wygenerowanym dokumencie.
          </p>
        </div>

        <SectionCard
          icon={PenLine}
          title="Podpis do operatu"
          sub="pojawia się w bloku autora operatu"
        >
          <div className="flex flex-col gap-3">
            {signature ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL, next/image adds nothing
              <img
                alt="Aktualny skan podpisu"
                className="max-h-24 w-fit rounded border bg-white p-2"
                src={`data:${signature.mime};base64,${signature.bytes.toString("base64")}`}
              />
            ) : null}
            <SignatureForm hasSignature={Boolean(signature)} />
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
