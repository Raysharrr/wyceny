# Slice 12 — Wizard Visual Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the 7-step wizard (and app chrome) to look like mockup v3-r4 — topbar, stepper+step headers everywhere (incl. create), 2-column layouts with sticky sidebars, bottom FootNav bar, AutoBanners — with ZERO domain/server/worker/template/DDL changes.

**Architecture:** Purely presentational slice. New shared chrome components (`Topbar`, `WizardShell`, `StepHeader`, `FootNav`, `AutoBanner`) + per-step JSX/classname recomposition. FootNav is a `position:fixed` bar rendered BY each step component (inside its `<form>` where the step is a form) — native submit keeps working and RTL tests keep seeing the button in the component tree. Live ΣUi/WR preview on step 4 calls the existing pure `computeKcs` client-side.

**Tech Stack:** Next.js 16 App Router (RSC + client islands), Tailwind v4 (`@theme` in globals.css), shadcn (radix-nova), react-hook-form, `next/font/google` (IBM Plex), Vitest+RTL (`@vitest-environment jsdom`), Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-07-24-wizard-visual-parity-design.md` (read it first — esp. the per-step table: eyebrow/title/description copy, sidebar content, FootNav mid, banner rules).

**Mockup (source of truth for look):** wiki-repo `raw/interactive-mockup/Wyceny - v2 - full code/` — `shared.jsx` (Stepper L146-177, Card L180-196, AutoBanner L199-208, FootNav L211-225), `styles.css` (tokens L7-53, topbar L80-106, stepper L108-148, page-head L153-161, footnav L195-206, split grid L379-386), `screens-1.jsx` (step 1 sidebar L125-143), `screen2.jsx` (step 3), `screen3.jsx` (step 4), `screens-4-5.jsx` (steps 5-6), `screen6.jsx` (step 7). Ignore folder "Wyceny - v3 - full code".

## Global Constraints

- **Frozen fitness:** F-1 golden (1 044 400 — engine file `apps/web/src/domain/kcs.ts` MUST NOT change), F-4 `approvalGate` untouched, F-7 (no new/changed mutations, no audit changes), F-9 synthetic fixtures, F-10 depcruise green, F-12 template untouched. Worker untouched. Zero DDL. Zero new exports in `"use server"` files.
- **Frozen UI strings (smoke asserts them):** "Zaloguj się", "Dane się zgadzają — dalej", "Dalej" (link, steps 2→3 and 6→7), "Dodaj transakcję", "Zatwierdź próbę i dalej", "Zatwierdź cechy i dalej", "Zatwierdź kalkulację i dalej", "Suma współczynników (ΣUi)" text, testids `gate-blockers`, `approve-button`, `confirm-features-button`, `valuation-status`, `iframe[title="Operat szacunkowy (PDF)"]`, ids `#email #password #address #area #purpose #kwNumber #client #inspectionDate #comparable-price-{i}`.
- **Language:** code+commits EN (conventional, ≤100 chars, lowercase, no attribution); UI copy PL with full diacritics.
- **Per task:** `pnpm turbo lint typecheck test build --env-mode=loose && pnpm exec dependency-cruiser --config .dependency-cruiser.cjs apps packages 2>/dev/null || pnpm depcruise` (use the repo's existing depcruise script) → commit → CONTROLLER pushes (subagents: if a PreToolUse guard blocks `git push`, do NOT bypass — leave the commit local and report) → `gh run list --branch main --limit 3 --json databaseId,headSha` → `gh run watch <id> --exit-status` for YOUR sha. Known flake: e2e job dies on "Install Playwright browsers" 15-min timeout → `gh run rerun <id> --failed`.
- **Prettier pre-commit:** `pnpm exec prettier --write <files>` before commit.
- **RTL:** pragma `// @vitest-environment jsdom` + `afterEach(cleanup)`; NO `clearMocks`. Tests are NOT colocated — they all live in `apps/web/tests/` (`rtl-*.test.tsx` naming); put new tests there too.
- **Auto-deploy:** every push to main deploys PROD (~50 s). Intermediate visual states on prod are ACCEPTED (user decision, checkpoint a).
- Repo: `/Users/michalczekala/Development/wyceny-app`. CodeGraph indexed — `codegraph explore "<question>"` before grep.

## File Structure (new)

```
apps/web/src/components/topbar.tsx              # brand + user, sticky top
apps/web/src/components/wizard/step-meta.ts     # STEP_META: eyebrow/title/description per step (plain module)
apps/web/src/components/wizard/step-header.tsx  # eyebrow "KROK N/7 — X" + h1 + description
apps/web/src/components/wizard/foot-nav.tsx     # fixed bottom bar: back | mid | children(primary)
apps/web/src/components/wizard/auto-banner.tsx  # green info bar (kind="warn" → amber)
apps/web/src/components/wizard/wizard-shell.tsx # Stepper + StepHeader + <main> wrapper
apps/web/src/app/valuations/layout.tsx          # Topbar for list + new + [id]
```

Modified (existing): `globals.css`, `app/layout.tsx` (fonts), `valuations/page.tsx` (list header),
`valuations/[id]/page.tsx`, `valuations/[id]/stepper.tsx` (restyle + create mode; WizardNav removed
at the end), `valuations/[id]/steps/step-*.tsx`, `valuations/[id]/cards.tsx` (`.num` on amounts),
`valuations/[id]/valuation-actions.tsx` (JSX split: approve button rendered via FootNav),
`valuations/new/page.tsx`, `valuations/new/subject-form.tsx`, `valuations/new/subject-section.tsx`
(map moves out), `e2e/smoke.spec.ts` (Task 0 only).

---

### Task 0: smoke — assert "Pobierz DOCX" link (fast-follow 11a)

**Files:**

- Modify: `apps/web/e2e/smoke.spec.ts` (in the walk test, right after the existing `valuation-status` → "Zatwierdzony" assertion and PDF iframe assertion)

**Interfaces:** none (test-only).

- [ ] **Step 1: Add the one-line assertion**

```ts
await expect(page.getByRole("link", { name: "Pobierz DOCX" })).toBeVisible();
```

If the exact accessible name differs (check the DOCX link JSX in `steps/step-operat.tsx` / `cards.tsx` — `codegraph explore "Pobierz DOCX link"`), use the exact rendered label; do NOT change the app label.

- [ ] **Step 2: Verify locally** — `pnpm turbo lint typecheck test build --env-mode=loose` (e2e runs in CI; locally just ensure compile). Expected: green.
- [ ] **Step 3: Commit** — `test: assert docx download link visible in smoke after approve`
- [ ] **Step 4: Controller pushes; watch CI green on your sha** (e2e must pass — this is the real verification).

### Task 1: fix 500 on `?step=1` for legacy v2 drafts

**Root cause (static analysis, line confirmed in source):** `subject-form.tsx:126` — the `useState` initializer for `kwState` does `[defaults.kw.kwLokalu, defaults.kw.kwGruntu, ...defaults.kw.kwInne]`. A legacy draft (Slice-10 era, e.g. `3c813f0e`) has `inputs.kw` saved BEFORE `kwInne` existed → spread of a non-iterable throws `TypeError` during SSR of the client component → 500. Fresh 11a drafts have the full/normalized shape → no crash.

**Why a 1-line spread guard is NOT enough (diag report):** the render would recover, but the draft would stay UNSAVEABLE — `step1Schema` requires `kwInne` (array) and `deweloperski` (boolean), and its `.nullable()` fields must be `null`, not `undefined`; `normalizeKw` (`kw-snapshot.ts:68`) also does `kw.kwInne.map(...)`. Fix = coerce the legacy `kw` to the full current shape at the defaults boundary, so the form state is schema-complete from the start (fixes render AND save; no data migration, no mutation changes).

**Files:**

- Modify: `apps/web/src/app/valuations/new/subject-form.tsx` (`step1DefaultsFromInputs`, L72-93)
- Test: `apps/web/tests/rtl-subject-form.test.tsx` (existing file — extend)

**Interfaces:** none outside the file (private helper; no schema/type/mutation changes; `KwSnapshot` type imported as today).

- [ ] **Step 1: Failing RTL test** (pragma jsdom + cleanup): render `<SubjectForm valuationId="x" defaults={step1DefaultsFromInputs(legacyValuation)} />` where `legacyValuation.inputs` has complete step-1 fields (address/area/purpose/client — synthetic, F-9) and `inputs.kw = { source: "odpis_kw", kwLokalu: "AB1C/1/9" }` (NO `kwInne`, NO `deweloperski`). Two assertions:
  1. **render:** today throws `TypeError`; after fix renders and the KW section summary shows `1 KW`;
  2. **save path:** click "Dane się zgadzają — dalej" → mocked `saveSubjectAction` receives a payload with `kw.kwInne` equal `[]` and `kw.deweloperski` equal `false` (follow the existing action-mock pattern of subject-form tests, `.findLast()` on `mock.calls`). Without the coercion this submit dies silently on the INVISIBLE `kw.kwInne` field (resolver requires an array) — the test must fail before the fix on this assertion too.

  (If `step1DefaultsFromInputs` is not exported, pass the equivalent `defaults` object directly, cast `as never`.)

- [ ] **Step 2: Run** → FAIL (TypeError: ... is not iterable).
- [ ] **Step 3: Fix — private helper + use it in `step1DefaultsFromInputs`:**

```tsx
function coerceLegacyKw(kw: Partial<KwSnapshot>): KwSnapshot {
  return {
    source: kw.source ?? "odpis_kw",
    kwLokalu: kw.kwLokalu ?? null,
    kwGruntu: kw.kwGruntu ?? null,
    kwInne: kw.kwInne ?? [],
    deweloperski: kw.deweloperski ?? false,
    powUzytkowaKw: kw.powUzytkowaKw ?? null,
    udzial: kw.udzial ?? null,
    sad: kw.sad ?? null,
    wydzial: kw.wydzial ?? null,
    dataDokumentu: kw.dataDokumentu ?? null,
    dzial3: kw.dzial3 ?? null,
    dzial4: kw.dzial4 ?? null,
  };
}
// in step1DefaultsFromInputs:
kw: v.inputs?.kw ? coerceLegacyKw(v.inputs.kw) : undefined,
```

(Field list = current `kwSchema`, `valuation-form-schema.ts:96-109` — implementer verifies 1:1 against the schema at implementation time; typecheck enforces completeness via the `KwSnapshot` return type.)

- [ ] **Step 4: Run test** → PASS; full `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` → green.
- [ ] **Step 5: Commit** — `fix: coerce legacy kw snapshot to current shape on step 1 edit`
- [ ] **Step 6 (after deploy, controller/QA):** verify on prod that `/valuations/3c813f0e…?step=1` renders (read-only page view). Optional user-run read-only SELECT (railway) confirms data shape + whether `e2cac945` is affected — see checkpoint note.

### Task 2: design tokens + IBM Plex fonts + `.num`

**Files:**

- Modify: `apps/web/src/app/globals.css` (`:root` L53-89, `.dark` L91-123, `@theme inline` L1-51)
- Modify: `apps/web/src/app/layout.tsx` (font setup L5-13)

**Interfaces:**

- Produces: CSS vars `--amber`, `--amber-bg`, `--amber-line`, `--human`, `--human-bg`, `--human-line`, `--accent-050`, `--accent-100`, `--accent-700`; utility class `.num`; Tailwind theme colors `amber-*`/`accent-*` usable as `bg-[var(--amber-bg)]` etc. Later tasks reference the VAR names exactly.

- [ ] **Step 1: Fonts.** In `layout.tsx` replace Geist imports:

```tsx
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
});
```

Apply both `.variable` classes where Geist variables were applied on `<html>`/`<body>`.

- [ ] **Step 2: globals.css.** In `@theme inline` point `--font-sans: var(--font-ibm-plex-sans)` and `--font-mono: var(--font-ibm-plex-mono)`. In `:root` set warm neutrals (hex is fine alongside oklch in Tailwind v4):

```css
--background: #f5f3ee;
--card: #ffffff;
--popover: #ffffff;
--foreground: #1c1b19;
--muted: #faf9f5;
--muted-foreground: #6f6c64;
--border: #e6e3dc;
--input: #d8d4ca;
/* accent shades (mockup styles.css L9-12) */
--accent-050: color-mix(in oklab, var(--primary) 9%, #fff);
--accent-100: color-mix(in oklab, var(--primary) 20%, #fff);
--accent-700: color-mix(in oklab, var(--primary) 80%, #000);
/* marking system (mockup L26-31) */
--amber: #b07a16;
--amber-bg: #fbf2dd;
--amber-line: #ecd9a6;
--human: #6b4fb0;
--human-bg: #f1edf9;
--human-line: #ddd2f0;
```

Keep `--primary` as is (`#1f7a5c` via `--brand-teal`). `.dark`: add the same NEW vars with darkened values (e.g. `--amber-bg: #3a2f12`) — dark is not QA'd this slice, it just must not break. Add utility:

```css
.num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  letter-spacing: -0.01em;
}
```

- [ ] **Step 3: Geist sweep** — `grep -ri geist apps/web/src` must return ZERO hits after the change (advisor: Geist lives only in `layout.tsx:2-13` + `globals.css` `@theme` literal "Geist").
- [ ] **Step 4: Visual sanity** — `pnpm --filter web dev`, open `/login` and `/valuations`: warm background, IBM Plex renders "ąćęłńóśźż" correctly (latin-ext). Screenshot not required; eyeball.
- [ ] **Step 5: Full check** — `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`. Expected: green (tokens don't touch selectors).
- [ ] **Step 6: Commit** — `feat: mockup design tokens, ibm plex fonts, num utility`

### Task 3: Topbar + `/valuations` layout + list header cleanup

**Files:**

- Create: `apps/web/src/components/topbar.tsx`
- Create: `apps/web/src/app/valuations/layout.tsx`
- Create: `apps/web/tests/rtl-topbar.test.tsx`
- Modify: `apps/web/src/auth/session.ts:6-38` (extend narrowed `SessionUser` with `name`)
- Modify: `apps/web/src/app/valuations/page.tsx:56-71` (header row)

**Interfaces:**

- Produces: `Topbar({ userName, userRole, children }: { userName: string; userRole: string; children?: React.ReactNode })` — presentational, RSC-compatible, NULL-SAFE on empty name. `valuations/layout.tsx` fetches the session and renders `<Topbar>` above `{children}`.
- **ADVISOR B1 (must-follow):** the narrowed `getSession()` (`auth/session.ts:6-38`) returns `{ user: { id, role } }` — NO `name`. Extend `SessionUser` with `name: string` sourced from the Better Auth user (the underlying user table HAS `name` — `db/auth-schema.ts:6`, seeded "Aneta"/"Zenon"). Role label mapping happens in the layout: `"appraiser" → "rzeczoznawca"`, `"admin" → "administrator"` (raw enum values must not leak into UI).

- [ ] **Step 1: Failing RTL test** (`apps/web/tests/rtl-topbar.test.tsx`, pragma jsdom):

```tsx
// @vitest-environment jsdom
import { afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Topbar } from "./topbar";
afterEach(cleanup);

it("renders brand and logged-in user", () => {
  render(<Topbar userName="Zenon Dembski" userRole="rzeczoznawca" />);
  expect(screen.getByText("Wyceny")).toBeInTheDocument();
  expect(screen.getByText("Zenon Dembski")).toBeInTheDocument();
  expect(screen.getByText("rzeczoznawca")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run** `pnpm --filter web test topbar` → FAIL (module not found).
- [ ] **Step 3: Implement Topbar** (mockup `styles.css` L80-106: sticky, h-60px, blurred bg, brand mono-mark + name, spacer, avatar with initials):

```tsx
import Link from "next/link";

export function Topbar({
  userName,
  userRole,
  children,
}: {
  userName: string;
  userRole: string;
  children?: React.ReactNode;
}) {
  const safeName = userName?.trim() || "—";
  const initials =
    safeName === "—"
      ? "?"
      : safeName
          .split(/\s+/)
          .map((p) => p[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();
  return (
    <header className="sticky top-0 z-40 flex h-[60px] items-center gap-4 border-b border-border bg-[color-mix(in_oklab,var(--muted)_86%,transparent)] px-6 backdrop-blur">
      <Link href="/valuations" className="flex items-center gap-3">
        <span className="grid size-[34px] place-items-center rounded-lg bg-[linear-gradient(160deg,#4a4763,#2e2c40)] text-sm font-semibold text-[#efeef5] shadow-sm">
          W
        </span>
        <span className="leading-tight">
          <span className="block text-[14.5px] font-semibold">Wyceny</span>
          <span className="block text-[11px] text-muted-foreground">operaty szacunkowe</span>
        </span>
      </Link>
      <span className="flex-1" />
      {children /* Profil link + Wyloguj form, provided by the LAYOUT (see Step 4) */}
      <span className="flex items-center gap-2.5 text-[12.5px] whitespace-nowrap">
        <span className="grid size-[30px] place-items-center rounded-full border border-[var(--accent-100)] bg-[var(--accent-050)] text-xs font-semibold text-[var(--accent-700)]">
          {initials}
        </span>
        <span className="leading-tight">
          <span className="block font-medium">{safeName}</span>
          <span className="block text-muted-foreground">{userRole}</span>
        </span>
      </span>
    </header>
  );
}
```

- [ ] **Step 4: extend `getSession()` + `valuations/layout.tsx`** — first add `name: string` to the narrowed `SessionUser` in `auth/session.ts` (source: the Better Auth user object the helper already reads — user table has `name`, `db/auth-schema.ts:6`). Then the layout (RSC):

```tsx
import { getSession } from "@/auth/session"; // same helper pages use
const ROLE_LABEL = { appraiser: "rzeczoznawca", admin: "administrator" } as const;

export default async function ValuationsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) return <>{children}</>; // pages keep their own redirect behavior
  return (
    <>
      <Topbar userName={session.user.name} userRole={ROLE_LABEL[session.user.role]}>
        {/* Profil link + Wyloguj form MOVED HERE from valuations/page.tsx:56-71 —
            rendered by the LAYOUT (advisor I5: they must appear on list AND new AND [id]).
            "Wyloguj" is a <form action={signOutAction}> — move the form verbatim. */}
      </Topbar>
      {children}
    </>
  );
}
```

- [ ] **Step 5: List header cleanup** (`valuations/page.tsx:56-71`): remove "Profil" and "Wyloguj" from the list's action row (they now live in the layout's Topbar children). "Nowa wycena" button stays on the list.
- [ ] **Step 6: Run tests** `pnpm --filter web test topbar` → PASS; full `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` → green.
- [ ] **Step 7: Commit** — `feat: global topbar with session user on valuations pages`

### Task 4: wizard chrome components — StepHeader/STEP_META, FootNav, AutoBanner

**Files:**

- Create: `apps/web/src/components/wizard/step-meta.ts`, `step-header.tsx`, `foot-nav.tsx`, `auto-banner.tsx`
- Create: `apps/web/tests/rtl-wizard-chrome.test.tsx`

**Interfaces (later tasks import EXACTLY these):**

- `STEP_META: Record<1|2|3|4|5|6|7, { eyebrow: string; title: string; description: string }>`
- `StepHeader({ step }: { step: keyof typeof STEP_META })`
- `FootNav({ back, mid, children }: { back?: { href: string; label?: string }; mid?: React.ReactNode; children?: React.ReactNode })` — `children` = primary action node; RSC-compatible, NO hooks.
- `AutoBanner({ children, kind }: { children: React.ReactNode; kind?: "info" | "warn" })`

- [ ] **Step 1: `step-meta.ts`** — copy VERBATIM from the spec's per-step table (eyebrow/title/description, PL, full diacritics). Example shape:

```ts
export const STEP_META = {
  1: {
    eyebrow: "KROK 1/7 — PRZEDMIOT WYCENY",
    title: "Dane przedmiotu",
    description:
      "Dane pobierane są automatycznie ze źródeł — zweryfikuj, uzupełnij braki; każde pole jest edytowalne.",
  },
  // ... 2-7 per spec table
} as const;
```

- [ ] **Step 2: Failing tests** (`apps/web/tests/rtl-wizard-chrome.test.tsx`, pragma jsdom + cleanup): StepHeader renders eyebrow+title+description for step 3; FootNav renders back link ("Wstecz", correct href), mid text, and its child button; AutoBanner renders children, `kind="warn"` gets amber classes (assert via `container.querySelector` class includes `--amber` var usage or a `data-kind="warn"` attribute — put `data-kind` on the root for testability).
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement:**

`step-header.tsx` (mockup `styles.css` L153-161):

```tsx
import { STEP_META } from "./step-meta";
export function StepHeader({ step }: { step: keyof typeof STEP_META }) {
  const m = STEP_META[step];
  return (
    <div className="mb-5">
      <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.06em] text-[var(--accent-700)]">
        {m.eyebrow}
      </p>
      <h1 className="mb-1.5 text-[25px] font-semibold tracking-[-0.015em]">{m.title}</h1>
      <p className="max-w-[70ch] text-[14.5px] text-muted-foreground">{m.description}</p>
    </div>
  );
}
```

`foot-nav.tsx` (mockup `styles.css` L195-206 + `shared.jsx` L211-225):

```tsx
import Link from "next/link";
export function FootNav({
  back,
  mid,
  children,
}: {
  back?: { href: string; label?: string };
  mid?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-[color-mix(in_oklab,var(--muted)_90%,transparent)] backdrop-blur">
      <div className="mx-auto flex max-w-[1240px] items-center gap-3.5 px-6 py-3.5">
        {back ? (
          <Link
            href={back.href}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            ← {back.label ?? "Wstecz"}
          </Link>
        ) : (
          <span className="w-24" />
        )}
        <div className="flex flex-1 items-center justify-center gap-3 text-[12.5px] text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground">
          {mid}
        </div>
        {children ?? <span className="w-24" />}
      </div>
    </div>
  );
}
```

`auto-banner.tsx` (mockup `.scanbar` `styles.css` L281-287; sparkle via lucide `Sparkles`):

```tsx
import { Sparkles, TriangleAlert } from "lucide-react";
export function AutoBanner({
  children,
  kind = "info",
}: {
  children: React.ReactNode;
  kind?: "info" | "warn";
}) {
  const warn = kind === "warn";
  return (
    <div
      data-kind={kind}
      className={
        "flex items-center gap-3 rounded-lg border px-4 py-3 text-[13.5px] font-medium " +
        (warn
          ? "border-[var(--amber-line)] bg-[var(--amber-bg)] text-[var(--amber)]"
          : "border-[var(--accent-100)] bg-[var(--accent-050)] text-[var(--accent-700)]")
      }
    >
      {warn ? (
        <TriangleAlert className="size-5 shrink-0" />
      ) : (
        <Sparkles className="size-5 shrink-0" />
      )}
      <span>{children}</span>
    </div>
  );
}
```

- [ ] **Step 5: Run tests** → PASS; full turbo+depcruise → green.
- [ ] **Step 6: Commit** — `feat: wizard chrome components - step header, foot nav, auto banner`

### Task 5: Stepper restyle + WizardShell + integrate on `[id]` (headers 2–7, FootNav on 2/6)

**Files:**

- Modify: `apps/web/src/app/valuations/[id]/stepper.tsx` (Stepper restyle + optional `valuationId`; leave `WizardNav` in place for now — removed in Task 10 when its last consumer goes)
- Create: `apps/web/src/components/wizard/wizard-shell.tsx`
- Modify: `apps/web/src/app/valuations/[id]/page.tsx:116-144` (wizard branch wraps in shell)
- Modify: `steps/step-inspection.tsx`, `steps/step-descriptions.tsx` (WizardNav → FootNav)

**Interfaces:**

- Produces: `WizardShell({ currentStep, maxReachedStep, valuationId, children }: { currentStep: number; maxReachedStep: number; valuationId?: string; children: React.ReactNode })` — renders Stepper + `<main class="px-6 pb-32 pt-7"><div class="mx-auto w-full max-w-[1240px]"><StepHeader/>{children}</div></main>`. `valuationId === undefined` → steps ≠ current render as disabled spans (create mode).
- Consumes: Task 4 components.

- [ ] **Step 1: Stepper restyle** (keep Link/disabled-span logic and `WIZARD_STEPS` labels VERBATIM; mockup `styles.css` L108-148): sticky `top-[60px] z-[39] h-[52px]` bar, `bg-muted border-b`, left "← Wyceny" link (`/valuations`, `border-r pr-4 mr-2 text-[12.5px] text-muted-foreground`); each step: round `size-6` dot (done: `bg-primary border-primary text-white` with lucide `Check size-3.5`; active: `border-primary text-[var(--accent-700)] bg-[var(--accent-050)]` + bottom border `border-b-2 border-primary` on the item; future: muted), label `text-[12.5px] font-medium`, `hidden sm:inline` on labels. **Create mode (advisor I6): when `valuationId === undefined`, render ALL steps as non-link spans** — otherwise step 1 (reachable) produces `href="/valuations/undefined?step=1"` (`stepper.tsx:44-46`). Existing Stepper assertions in `apps/web/tests/rtl-stepper.test.tsx` must stay green (restyle = classes only, roles/labels unchanged).
- [ ] **Step 2: WizardShell** as per Interfaces (thin composition — no logic).
- [ ] **Step 3: Integrate in `[id]/page.tsx`** wizard branch: wrap the step switch in `<WizardShell currentStep={step} maxReachedStep={maxReached} valuationId={id}>`. h2 removal is PER-TASK (advisor nit): this task deletes only the ad-hoc titles of steps it touches (2: `step-inspection`, 6: `step-descriptions` — but KEEP the empty-state h2 "Opisy" content card if it doubles as content, `step-descriptions.tsx:14`); steps 1/3/4 h2s go in Tasks 7/8/9; step-5 empty-state h2 "Kalkulacja niedostępna" (`step-calculation.tsx:23`) STAYS. Flat view branch NOT wrapped.
- [ ] **Step 4: FootNav on steps 2 and 6:** in `step-inspection.tsx` and `step-descriptions.tsx` replace their `WizardNav` usage with `<FootNav back={{ href: `/valuations/${id}?step=${prev}` }} mid={...}><Link className="…primary…" href={`/valuations/${id}?step=${next}`}>Dalej</Link></FootNav>`. Primary link styled as `bg-primary text-primary-foreground rounded-lg px-5 py-3 text-[14.5px] font-medium inline-flex items-center gap-2 shadow-sm hover:bg-[var(--accent-700)]` — label stays EXACTLY `Dalej` (smoke). Mid step 2: `Oględziny: <b>{totalInspectionPhotos(inspection)} zdjęć</b>` (existing helper `domain/inspection.ts:36` — server snapshot count, acceptable). Mid step 6: `Opisy z szablonu przy zatwierdzeniu`. Remove the now-unused `import { WizardNav }` from each migrated file (eslint no-unused-vars fails lint otherwise) — this applies to EVERY WizardNav-migrating task (5, 6, 8, 9, 10).
- [ ] **Step 5: RTL** — update any step-2/6 tests referencing WizardNav structure; run `pnpm --filter web test` → PASS. Full turbo+depcruise → green.
- [ ] **Step 6: Commit** — `feat: wizard shell with restyled stepper, step headers, footnav on steps 2 and 6`

### Task 6: step 7 — FootNav with approve action (JSX split inside ValuationActions)

**Files:**

- Modify: `apps/web/src/app/valuations/[id]/steps/step-operat.tsx`, `valuation-actions.tsx` (+ its test)

**Interfaces:**

- Consumes: `FootNav` (Task 4). No new props elsewhere.

- [ ] **Step 1:** In `valuation-actions.tsx` (client), keep ALL state/handlers identical; move ONLY the primary approve `<Button data-testid="approve-button">Zatwierdź operat</Button>` JSX into a `<FootNav back={{ href: `?step=6`, label: "Wstecz" }} mid={<span>Wartość rynkowa <b className="num">{wrFormatted}</b></span>}>` rendered by the same component (fixed bar — DOM location inside the card container is irrelevant visually). **GATE IT (advisor I1): `{canApprove ? <FootNav>…</FootNav> : null}`** — `ValuationActions` is ALSO rendered on the flat view (`[id]/page.tsx:296`, approved/signed, `canApprove=false`); an unconditional FootNav would overlay the PDF iframe there. **New `wr` prop must be OPTIONAL (advisor I2)** — `wr?: number | null`, mid null-safe (when absent/null show the existing blocker hint text) — otherwise `rtl-valuation-actions-maps.test.tsx:31-41` and `rtl-valuation-actions-sign.test.tsx` baseProps fail typecheck. Secondary actions ("Podpisz operat…", "Utwórz nową wersję", "Zatwierdź bez map") stay in the card.
- [ ] **Step 2:** Remove step-7's `WizardNav` back link (FootNav has back now).
- [ ] **Step 3:** RTL: existing valuation-actions tests must still pass (testid unchanged, same tree). Run `pnpm --filter web test valuation-actions` → PASS; full turbo+depcruise → green.
- [ ] **Step 4: Commit** — `feat: step 7 approve action in footnav bar`

### Task 7: step 1 (create + edit) — shell, 2-col layout, map sidebar, AutoBanner, FootNav

**Files:**

- Modify: `apps/web/src/app/valuations/new/page.tsx`, `subject-form.tsx` (L154-178 form setup, L341-353 submit, L474-476 button), `subject-section.tsx` (MapPreview out, L117-161/184), `[id]/page.tsx` step-1 edit branch (same shell)
- Modify: `apps/web/tests/rtl-subject-form.test.tsx` (extend)

**Interfaces:**

- Consumes: `WizardShell` (`valuationId` undefined on create → steps 2-7 disabled), `StepHeader` (rendered by shell), `FootNav`, `AutoBanner`.

- [ ] **Step 1: Shell on create:** `new/page.tsx` renders `<WizardShell currentStep={1} maxReachedStep={1}>` around the form (replaces the current bare kicker+h1 — StepHeader supplies the header). Edit-mode step 1 in `[id]/page.tsx` already goes through Task 5's shell.
- [ ] **Step 2: 2-col layout in `subject-form.tsx`:** wrap content in `<div className="grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">`; left column = existing sections (cards); right column:

```tsx
<aside className="flex flex-col gap-4 lg:sticky lg:top-[128px]">
  <MapPreview ... />           {/* moved from subject-section.tsx — same props/data flow */}
  <section className="rounded-[14px] border border-border bg-card p-5 shadow-sm">
    <p className="text-[14.5px] font-semibold">{watchedAddress || "—"}</p>
    <p className="text-[12.5px] text-muted-foreground">{/* city/district if the form has such fields; otherwise omit the line */}</p>
    <dl className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
      <div><dt className="text-muted-foreground">Powierzchnia</dt><dd className="num text-[15px]">{watchedArea ? `${watchedArea} m²` : "—"}</dd></div>
      {/* second tile only if a floor/rooms field exists in the form — do NOT invent fields */}
    </dl>
  </section>
</aside>
```

`watchedAddress`/`watchedArea` via `useWatch({ control, name: "address" | "area" })` (exact field names from `step1Schema`). MapPreview keeps its `data-testid="map-preview"` and data flow (fire-and-forget `getMapPreview`; state already lives in `subject-form.tsx:118`) — ONLY its render location moves. **`MapPreview` is a PRIVATE function in `subject-section.tsx:117-161` (advisor I7) — add `export` and import it in `subject-form.tsx`.** Remove step-1's own ad-hoc h2 (`subject-section.tsx:177`) — StepHeader takes over.

- [ ] **Step 3: AutoBanner:** restyle the existing fetch-status bar (`SubjectFetchStatusBar`, private in `subject-section.tsx:71-113`) — **green `<AutoBanner>` ONLY for the `done` state**; `loading`/`error`/`outOfCoverage` keep visually distinct treatment (`loading` neutral, `error`/`outOfCoverage` as `<AutoBanner kind="warn">` or the current styling). Success copy may become "Pobrano dane przedmiotu: EGiB, MPZP, geokoder" — this bar's copy is NOT smoke-frozen; verify with `grep -n` in e2e first.
- [ ] **Step 4: FootNav:** move the submit button (L474-476) INSIDE the form's JSX into `<FootNav mid={<span>Przedmiot: <b>lokal mieszkalny{watchedArea ? `, ${watchedArea} m²` : ""}</b></span>}><Button type="submit">Dane się zgadzają — dalej</Button></FootNav>` (label byte-identical). Edit mode: `back={{ href: "/valuations" }}`; create: no back. FootNav sits inside `<form>` → native submit preserved.
- [ ] **Step 5: RTL:** existing subject-form tests must pass unchanged (button still in tree). Add one assertion: sidebar shows `map-preview` testid and the area tile updates from a filled form value.
- [ ] **Step 6:** Full turbo+depcruise → green. **Step 7: Commit** — `feat: step 1 visual parity - shell on create, map sidebar, footnav, auto banner`

### Task 8: step 3 — sample stats sidebar + RCN AutoBanner + FootNav

**Files:**

- Modify: `steps/step-sample.tsx` (stats L114-123, render L309-333; drop its own h2 at L170 — StepHeader takes over) + its test in `apps/web/tests/`

**Interfaces:**

- Consumes: `FootNav`, `AutoBanner`. `sampleMeta` type `SampleMeta` (`ports/sample.ts:15-25`: `fetchedAt: string`, `query: { count: number, … }`).

- [ ] **Step 1: Failing RTL test:** with ≥2 comparable prices filled, sidebar shows "Statystyki próby" with Cmin/Cmax/Cśr and "Granice korekty" range values `Vmin = Cmin/Cśr`, `Vmax = Cmax/Cśr` formatted `0,920`-style (`toLocaleString("pl-PL", { minimumFractionDigits: 3 })`); with `sampleMeta` prop present, AutoBanner shows `Pobrano {query.count} transakcji z RCN`.
- [ ] **Step 2:** Run → FAIL. **Step 3: Implement:** wrap step content in the `1.6fr/1fr` grid; move the existing inline stats block (L309-322) into sticky `<aside>` card "Statystyki próby"; extend with:

```tsx
const vMin = stats ? stats.min / stats.avg : null;
const vMax = stats ? stats.max / stats.avg : null;
const csrPos =
  stats && stats.max > stats.min ? (stats.avg - stats.min) / (stats.max - stats.min) : null;
```

rangebar (mockup `styles.css` L266-268): outer `h-2 rounded-full bg-border relative overflow-hidden`, fill `absolute inset-y-0 bg-[var(--accent-100)]` full-width, pin `absolute -top-[3px] h-3.5 w-0.5 bg-primary` at `left: ${csrPos*100}%`; caption `Granice korekty [<span class="num">{fmt(vMin)}</span> ; <span class="num">{fmt(vMax)}</span>]`. AutoBanner above the table: `Pobrano <b>{sampleMeta.query.count} transakcji</b> z RCN ({new Date(sampleMeta.fetchedAt).toLocaleDateString("pl-PL")})` — render only when `sampleMeta` exists. FootNav inside the form: mid `Próba: <b>{validCount} transakcji</b>{stats ? <> · Cśr <b className="num">{fmtPln(stats.avg)} zł/m²</b></> : null}`, primary = existing submit button (label frozen `Zatwierdź próbę i dalej`), back `?step=2`.

- [ ] **Step 4:** tests PASS + existing step-sample tests untouched-green; full turbo+depcruise. **Step 5: Commit** — `feat: step 3 visual parity - stats sidebar, rcn auto banner, footnav`

### Task 9: step 4 — live ΣUi/WR sidebar (client computeKcs) + FootNav

**Files:**

- Modify: `steps/step-features.tsx` (props + sidebar + FootNav; drop its own h2 at L158)
- Modify: `apps/web/src/app/valuations/[id]/page.tsx:133-137` (step-4 branch: pass new props)
- Test: `apps/web/tests/rtl-features-section.test.tsx` (extend; NEW fixture needed)

**Interfaces:**

- Consumes: `computeKcs` + types from `@/domain/kcs` (PURE — do NOT modify the module; `import { computeKcs } from "@/domain/kcs"` is allowed in client code, F-10 has no rule against it — verified; value-imports from domain into this client file already exist, `step-features.tsx:22-26`).
- **ADVISOR B2 (must-follow):** `StepFeatures` props today are `{ valuationId, features, comparableAreas }` (`step-features.tsx:99-107`) — comparable AREAS only, no prices, no subject `area`; `computeKcs` THROWS on empty comparables / `pricePerM2 ≤ 0` / `area ≤ 0` (`kcs.ts:104-116`). EXTEND props: `comparables: Comparable[]` (with prices) + `area: number`, passed from the RSC step-4 branch (`valuation.inputs?.comparables ?? []`, subject area from the same `valuation` the page already loads). `comparableAreas` can then be derived from `comparables` (drop the old prop if nothing else uses it).
- Produces (for its own render only): live `{ sumUi, wr, pricePerM2 } | null`.

- [ ] **Step 0 (guard):** confirm `pnpm depcruise` green after adding the import (expected: yes) and `pnpm --filter web build` — check first-load JS of the step route doesn't jump by more than a few KB (engine is 139 lines). If either fails → STOP, report (fallback per spec: ΣUi-only sum, decision returns to user).
- [ ] **Step 1: Failing RTL test:** the existing fixture has EMPTY comparables (`rtl-features-section.test.tsx:34`) — create a NEW synthetic fixture (F-9) with ≥3 priced comparables + `area: 71.63`. Render, change one rating via UI, assert sidebar "Wskaźnik korekty ΣUi" shows the recomputed value and "Podgląd wartości (WR)" shows a `zł` amount; ALSO render with the old empty-comparables fixture and assert sidebar shows "—" (throw-path guard).
- [ ] **Step 2:** FAIL. **Step 3: Implement:** compose the SAME `KcsInput` the confirm path builds (mirror the construction used by `cards.tsx`/`step-calculation.tsx` — `codegraph explore "KcsInput construction"`), from the NEW props + live `useWatch` ratings/weights:

```tsx
const watched = useWatch({ control }); // ratings + weights
const live = React.useMemo(() => {
  try {
    return computeKcs(buildKcsInput({ comparables, area }, watched));
  } catch {
    return null;
  }
}, [comparables, area, watched]);
```

Sidebar (mockup `screen3.jsx` sidebar): card "Wskaźnik korekty ΣUi" — big `.num text-[28px]` ΣUi, caption `lokal {ΣUi > 1 ? "lepszy" : ΣUi < 1 ? "gorszy" : "równy"} od średniej rynkowej`, rangebar Vmin/1,000/Vmax (Vmin/Vmax from comparables like Task 8); card "Podgląd wartości (WR)" — rows `Cśr × ΣUi = cena jedn.` and `× {area} m² = <b class="num">{WR} zł</b>` from `live`, all "—" when `live == null`. FootNav inside form: mid `ΣUi <b className="num">{fmtSum}</b> · podgląd WR <b className="num">{fmtWr} zł</b>` (or "—"), primary = existing submit (`Zatwierdź cechy i dalej`), back `?step=3`. Layout: `1.6fr/1fr` grid + sticky aside.

- [ ] **Step 4:** tests PASS (new + existing); full turbo+depcruise; note bundle delta in the task report. **Step 5: Commit** — `feat: step 4 live sum-ui and wr preview sidebar via client kcs engine`

### Task 10: step 5 — AutoBanner, T1–T4 card grid, confirm in FootNav; remove WizardNav

**Files:**

- Modify: `steps/step-calculation.tsx`, `confirm-calculation-button.tsx` (if separate), `cards.tsx` (add `.num` to amounts — NO logic changes), `stepper.tsx` (delete now-unused `WizardNav`)

**Interfaces:**

- Consumes: `FootNav`, `AutoBanner`. `ConfirmCalculationButton` keeps its labels ("Zatwierdź kalkulację i dalej" / "Dalej") and action.

- [ ] **Step 1:** Top of step 5: `<AutoBanner>Wynik policzony automatycznie z zatwierdzonej próby i ocen.</AutoBanner>`; the EXISTING amber invalidation notice ("Dane wejściowe zmieniły się…") becomes `<AutoBanner kind="warn">` with identical text.
- [ ] **Step 2:** Cards T1–T4: arrange in `grid gap-4 md:grid-cols-2` (T1 full-width `md:col-span-2` if it's the wide table; follow mockup `screens-4-5.jsx` L1-120 arrangement); amounts get `.num`.
- [ ] **Step 3:** `<FootNav back={{ href: "?step=4" }} mid={<span>Wartość rynkowa <b className="num">{wrFormatted} zł</b></span>}><ConfirmCalculationButton …/></FootNav>` — **BOTH branches of `step-calculation.tsx` (advisor I3):** the ready branch replaces the inline `<div><Link>Wstecz</Link><ConfirmCalculationButton/></div>` (L44-49), and the not-ready branch ("Kalkulacja niedostępna", `<WizardNav back={4}>` at L30) gets `<FootNav back={{ href: "?step=4" }} mid="—" />` with no primary. Keep the not-ready h2 "Kalkulacja niedostępna" (L23). When wr invalidated, mid shows "—".
- [ ] **Step 4:** Delete `WizardNav` from `stepper.tsx` — `codegraph explore "WizardNav callers"` must show zero remaining callers (steps 2/6 in Task 5, 7 in Task 6, 3 in Task 8, 4 in Task 9, 5 here). If any remain, migrate them here the same way. **Also (advisor I4): `apps/web/tests/rtl-stepper.test.tsx:8` imports `WizardNav` and `:63-81` renders it — remove the import and the whole WizardNav describe-block in the SAME commit**, or the test file crashes with "Element type is invalid".
- [ ] **Step 5:** RTL green; full turbo+depcruise. **Step 6: Commit** — `feat: step 5 visual parity - auto banner, card grid, confirm in footnav; drop wizard nav`

### Task 11: QA — side-by-side vs mockup, prod verification, punch-list

**Files:** none (QA + possible one-commit nits batch)

- [ ] **Step 1:** Serve mockup: `cd "/Users/michalczekala/Development/wyceny/raw/interactive-mockup" && python3 -m http.server 8788`. Prod: `vercel ls` (latest Ready) + open https://wyceny-mu.vercel.app.
- [ ] **Step 2:** Fresh QA draft as zenon (demo-login button) — walk steps 1→7 side-by-side with the clickable mockup (login → lista → "ul. Kościelna 33/36"). Browser via chrome-devtools MCP; REAL clicks (no synthetic `.click()` — lesson 11a); React inputs via native setter + `input` event.
- [ ] **Step 3:** Also verify: flat view of approved valuation `7c99d991` (topbar present, no FootNav, PDF iframe unobstructed), list page, `/login` (untouched), dark-mode quick glance (nothing unreadable). DO NOT touch signed QA valuations (`5faecc25`, `f9af0aba`, `11e60dde`).
- [ ] **Step 4:** Produce punch-list (zgodne / rozjazd strukturalny / rozjazd stylistyczny / świadome odstępstwo) → PRESENT TO USER (checkpoint c). Small nits may be fixed in ONE batch commit before the checkpoint; anything bigger goes on the list for the user to decide.
- [ ] **Step 5:** Prod DB untouched check is N/A (no DDL); `railway` not needed this slice.

---

## Advisor review (2026-07-24) — APPLIED

Advisor found 2 BLOCKERS + 8 IMPORTANT; all folded into the tasks above: B1 (session has no
`user.name` — extend `SessionUser`, role label mapping, null-safe Topbar → Task 3), B2
(`StepFeatures` lacks priced comparables + area for `computeKcs` → Task 9 props + new fixture),
I1 (FootNav gated on `canApprove` — flat view PDF overlay → Task 6), I2 (`wr` prop optional →
Task 6), I3 (both step-5 branches migrate → Task 10), I4 (`rtl-stepper.test.tsx` WizardNav
cleanup → Task 10), I5 (Topbar children from LAYOUT → Task 3), I6 (create-mode stepper all-spans
→ Task 5), I7 (export private `MapPreview`; AutoBanner only for `done` → Task 7), I8 (tests live
in `apps/web/tests/` → global + per-task paths). Verdict after fixes: plan ready.

## Self-review notes

- Spec coverage: tokens/fonts (T2), topbar globally (T3), shell+stepper+headers incl. create (T5/T7), FootNav all steps (T5:2,6; T6:7; T7:1; T8:3; T9:4; T10:5), sidebars K1/K3/K4 (T7/T8/T9), no-sidebar K5 grid (T10), AutoBanners 1/3/5 + warn restyle (T7/T8/T10), banner K4 deliberately absent (spec dec. 6), smoke DOCX (T0), bug step=1 (T1 pending diag), side-by-side gate (T11).
- Frozen strings repeated in Global Constraints and inside each task that touches them.
- Type consistency: `FootNav` props (`back/mid/children`) identical across T4-T10; `STEP_META` keys 1-7; `WizardShell` signature defined once (T5), consumed T7.
