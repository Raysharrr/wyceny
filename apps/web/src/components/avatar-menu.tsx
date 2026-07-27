"use client";

import Link from "next/link";
import { Building2, CircleHelp, Lock, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/app/actions/sign-out";

const SIGN_OUT_FORM_ID = "topbar-sign-out";

/**
 * Avatar dropdown rendered by `Topbar` (Task 15, mockup `account.jsx`
 * `AvatarMenu` L67-99): the ambient name/role text + avatar button open a
 * menu with the session head (name, e-mail, role badge), "Pomoc" (Slice 13,
 * Task 5), "Profil i ustawienia", and "Wyloguj" — replacing the bare Profil
 * link / Wyloguj form that used to sit directly in the topbar. The mockup's
 * "Użytkownicy i role" item is deliberately omitted: that screen doesn't
 * exist in the app yet, and this menu should never link somewhere dead.
 *
 * "Wyloguj" keeps the existing `signOutAction` mechanism verbatim (a real
 * `<form action={signOutAction}>` with a submit button) — the button lives
 * inside the `DropdownMenuItem` (so Radix gives it focus/keyboard handling)
 * and is associated with the form via the HTML `form` attribute instead of
 * DOM nesting, since a `<form>` can't itself be the focusable menu item.
 */
export function AvatarMenu({
  name,
  email,
  userRole,
  initials,
}: {
  name: string;
  email: string;
  userRole: string;
  initials: string;
}) {
  return (
    <DropdownMenu>
      <span className="flex items-center gap-2.5 text-[12.5px] whitespace-nowrap">
        <span className="leading-tight">
          <span className="block font-medium">{name}</span>
          <span className="block text-muted-foreground">{userRole}</span>
        </span>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Konto"
            className="grid size-[30px] place-items-center rounded-full border border-[var(--accent-100)] bg-[var(--accent-050)] text-xs font-semibold text-[var(--accent-700)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {initials}
          </button>
        </DropdownMenuTrigger>
      </span>
      <DropdownMenuContent align="end" sideOffset={12} className="w-64 rounded-xl p-1.5 shadow-lg">
        <div className="mb-1.5 border-b border-border px-3 py-2.5">
          <p className="text-[13.5px] font-semibold">{name}</p>
          <p className="text-xs text-muted-foreground">{email}</p>
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-100)] bg-[var(--accent-050)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-700)]">
            <Lock className="size-[11px]" />
            {userRole} · pełny dostęp
          </span>
        </div>
        <DropdownMenuItem asChild>
          <Link href="/pomoc" className="flex items-center gap-2.5">
            <CircleHelp className="size-4" />
            Pomoc
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/profile" className="flex items-center gap-2.5">
            <Building2 className="size-4" />
            Profil i ustawienia
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild variant="destructive">
          <button
            type="submit"
            form={SIGN_OUT_FORM_ID}
            className="flex w-full items-center gap-2.5"
          >
            <LogOut className="size-4" />
            Wyloguj
          </button>
        </DropdownMenuItem>
        <form id={SIGN_OUT_FORM_ID} action={signOutAction} className="hidden" aria-hidden />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
