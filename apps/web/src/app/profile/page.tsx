import { redirect } from "next/navigation";
import Link from "next/link";
import { FileBadge, PenLine, UserRound } from "lucide-react";
import { getSession } from "@/auth/session";
import { profileRepository } from "@/app/valuations/_deps";
import { SectionCard } from "@/components/wizard/section-card";
import { AuthorForm } from "./author-form";
import { InsuranceForm } from "./insurance-form";
import { SignatureForm } from "./signature-form";

/**
 * Restyled to the makieta's "Profil i ustawienia" screen shell (page-head +
 * SectionCard, Task 15) — the wizard's `max-w-[1240px]` outer width, a
 * narrower `max-w-2xl` column for the cards.
 *
 * Three cards since ADR-020 cz. 1: the author block and the OC policy joined
 * the signature scan that was already here. All three describe the APPRAISER
 * rather than any one valuation, which is why the approval gate links its
 * B-15/B-16 blockers to this screen instead of to a wizard step. The mockup's
 * weights / grade-scale fields remain separate, unbuilt features.
 */
export default async function ProfilePage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [profile, signature] = await Promise.all([
    profileRepository.get(session.user.id),
    profileRepository.getSignature(session.user.id),
  ]);

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

        <div className="flex flex-col gap-4">
          <SectionCard
            icon={UserRound}
            title="Dane autora operatu"
            sub="trafiają na stronę tytułową i pod podpis"
          >
            <AuthorForm profile={profile} />
          </SectionCard>

          <SectionCard icon={FileBadge} title="Polisa OC" sub="Załącznik nr 1 do każdego operatu">
            <InsuranceForm
              hasPolicy={Boolean(profile?.insuranceDocKey)}
              validUntil={profile?.insuranceValidUntil ?? null}
            />
          </SectionCard>

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
    </div>
  );
}
