// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AutoBanner } from "@/components/wizard/auto-banner";

afterEach(cleanup);

/**
 * `AutoBanner` variants (spec §12a, approved 15.09): `info` = data from the
 * automat, `note` = neutral status, `warn` = needs attention, `error` = a
 * failed operation. Each variant is told apart by its role, icon and colour
 * tokens — the role matters beyond looks: `error` must interrupt a screen
 * reader (`alert`), the other three only announce (`status`).
 */
const CASES = [
  { kind: "info", role: "status", icon: "lucide-sparkles", token: "--accent-700" },
  { kind: "note", role: "status", icon: "lucide-info", token: "brand-blue" },
  { kind: "warn", role: "status", icon: "lucide-triangle-alert", token: "--amber" },
  { kind: "error", role: "alert", icon: "lucide-circle-alert", token: "destructive" },
] as const;

describe("AutoBanner", () => {
  it.each(CASES)("kind=$kind → role $role, icon $icon, colour $token", (c) => {
    render(<AutoBanner kind={c.kind}>Treść banera</AutoBanner>);
    const banner = screen.getByRole(c.role);
    expect(banner.getAttribute("data-kind")).toBe(c.kind);
    expect(banner.textContent).toBe("Treść banera");
    expect(banner.querySelector("svg")?.getAttribute("class")).toContain(c.icon);
    expect(banner.className).toContain(c.token);
  });

  it("defaults to info, so the existing call sites render unchanged", () => {
    render(<AutoBanner>Pobrano dane</AutoBanner>);
    const banner = screen.getByRole("status");
    expect(banner.getAttribute("data-kind")).toBe("info");
    expect(banner.querySelector("svg")?.getAttribute("class")).toContain("lucide-sparkles");
  });
});
