// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { AvatarMenu } from "@/components/avatar-menu";

// `AvatarMenu` imports the sign-out server action directly; stub it so the
// component renders in jsdom without pulling the server runtime in.
vi.mock("@/app/actions/sign-out", () => ({ signOutAction: vi.fn() }));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

async function openMenu() {
  const user = userEvent.setup();
  render(
    <AvatarMenu
      name="Aneta Kowalska"
      email="aneta@dembscy.pl"
      userRole="administrator"
      initials="AK"
    />,
  );
  await user.click(screen.getByRole("button", { name: "Konto" }));
}

describe("AvatarMenu", () => {
  // Radix stamps role="menuitem" onto the `asChild` anchor, which shadows the
  // implicit `link` role — hence the menuitem query plus an explicit href
  // assertion (name alone would survive a wrong href).
  it("links to the help module at /pomoc", async () => {
    await openMenu();

    expect(screen.getByRole("menuitem", { name: /pomoc/i })).toHaveAttribute("href", "/pomoc");
  });

  it("places Pomoc above Profil i ustawienia", async () => {
    await openMenu();

    const items = screen.getAllByRole("menuitem");
    const help = items.indexOf(screen.getByRole("menuitem", { name: /pomoc/i }));
    const profile = items.indexOf(screen.getByRole("menuitem", { name: /profil i ustawienia/i }));

    expect(help).toBeGreaterThanOrEqual(0);
    expect(help).toBeLessThan(profile);
  });

  // Guards the mechanism verified empirically in Slice 12: "Wyloguj" is a
  // submit button associated with the hidden sign-out form via `form=`,
  // not by DOM nesting (a <form> can't be the focusable menu item).
  it("keeps the sign-out submit wired to the hidden form by id", async () => {
    await openMenu();

    const signOut = screen.getByRole("menuitem", { name: /wyloguj/i });
    expect(signOut).toHaveAttribute("type", "submit");
    const formId = signOut.getAttribute("form");
    expect(formId).toBeTruthy();
    expect(document.querySelector(`form#${formId}`)).toBeInTheDocument();
  });
});
