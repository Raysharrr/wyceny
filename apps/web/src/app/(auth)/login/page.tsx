import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect("/valuations");
  }

  return (
    <div className="grid min-h-screen w-full lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[linear-gradient(160deg,#3a3850,#262434)] px-[60px] py-[56px] text-[#efeef5] lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute top-[158px] right-[86px] h-[300px] w-[220px] -rotate-[4deg] rounded-md border border-white/10 bg-white/5 opacity-50 shadow-[0_30px_60px_-20px_rgba(0,0,0,.4)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-[130px] right-10 h-[300px] w-[220px] rotate-6 rounded-md border border-white/10 bg-white/5 shadow-[0_30px_60px_-20px_rgba(0,0,0,.4)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-[120px] -bottom-[120px] size-[420px] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,.07),transparent_65%)]"
        />

        <div className="relative z-10 flex items-center gap-3">
          <span className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-[linear-gradient(160deg,#4a4763,#2e2c40)] text-sm font-semibold text-[#efeef5] shadow-sm">
            W
          </span>
          <span className="leading-tight">
            <span className="block text-[14.5px] font-semibold">Wyceny</span>
            <span className="block text-[11px] text-[#efeef5]/70">operaty szacunkowe</span>
          </span>
        </div>

        <div className="relative z-10 max-w-[320px]">
          <p className="text-[22px] leading-[1.3] font-semibold tracking-[-0.01em]">
            Operat szacunkowy w 10–30 minut zamiast 3 godzin.
          </p>
          <p className="mt-3 text-[13px] text-[#efeef5]/65">
            Automatyzacja z pełną kontrolą rzeczoznawcy — każda liczba ze źródłem, każdy krok do
            potwierdzenia.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center bg-background p-6 sm:p-10">
        <LoginForm />
      </div>
    </div>
  );
}
