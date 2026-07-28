import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auth gate on `/api/pomoc/[name]` (Slice 13, follow-up).
 *
 * The help screenshots used to sit in `public/pomoc/` — Next serves that
 * directory as static assets, entirely bypassing `getSession()`, so
 * `/pomoc/krok-3-proba.png` was readable signed out even though `/pomoc`
 * and every `/pomoc/[slug]` page redirect to `/login`. One screenshot had
 * to be deleted after it leaked an appraiser's handwritten signature and
 * stamp. The bytes now live outside `public/` and are served only through
 * this route.
 *
 * `getSession` reads `next/headers`, which has no meaning outside a real
 * Next.js request — mocked here. Everything downstream (name validation,
 * path containment, the real `fs` read of the real PNGs) runs for real.
 */
const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
vi.mock("@/auth/session", () => ({ getSession: getSessionMock }));

const { GET } = await import("@/app/api/pomoc/[name]/route");

const IMG_DIR = fileURLToPath(new URL("../src/content/pomoc/img/", import.meta.url));

const session = { user: { id: "u-1", name: "A", email: "a@example.test", role: "appraiser" } };

const paramsFor = (name: string) => ({ params: Promise.resolve({ name }) });

const get = (name: string) => GET(new Request(`http://test/api/pomoc/${name}`), paramsFor(name));

beforeEach(() => {
  getSessionMock.mockReset();
});

describe("/api/pomoc/[name] — brama sesji", () => {
  it("brak sesji -> 401, zero bajtow obrazu", async () => {
    getSessionMock.mockResolvedValue(null);

    const res = await get("krok-3-proba.png");

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).not.toBe("image/png");
  });

  it("sesja + istniejaca nazwa -> 200, image/png, dokladnie te bajty co na dysku", async () => {
    getSessionMock.mockResolvedValue(session);

    const res = await get("krok-3-proba.png");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(await readFile(`${IMG_DIR}krok-3-proba.png`))).toBe(true);
  });

  it("Cache-Control jest prywatny — zrzuty nie moga wpasc do wspoldzielonego cache CDN", async () => {
    getSessionMock.mockResolvedValue(session);

    const res = await get("krok-3-proba.png");

    const cacheControl = res.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("private");
    expect(cacheControl).not.toContain("public");
    expect(cacheControl).not.toContain("s-maxage");
  });

  it("sesja + nieistniejaca (ale poprawna) nazwa -> 404", async () => {
    getSessionMock.mockResolvedValue(session);

    const res = await get("nie-ma-takiego-zrzutu.png");

    expect(res.status).toBe(404);
  });
});

describe("/api/pomoc/[name] — wyjscie poza katalog zrzutow", () => {
  /**
   * Kazdy cel NAPRAWDE istnieje na dysku (`src/content/pomoc/manifest.ts`,
   * `apps/web/package.json`). To jest nosne: przy sciezce nieistniejacej
   * `readFile` rzuciloby i tak, test przechodzilby na pusto i nie wykrylby
   * usuniecia walidacji.
   */
  it.each([["../manifest.ts"], ["../../pomoc/manifest.ts"], ["../../../../package.json"]])(
    "odmawia %s",
    async (name) => {
      getSessionMock.mockResolvedValue(session);

      const res = await get(name);

      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).not.toContain("HELP_PAGES");
      expect(body).not.toContain('"scripts"');
    },
  );

  it("odmawia sciezki, ktora po normalizacji wraca do katalogu zrzutow", async () => {
    getSessionMock.mockResolvedValue(session);

    const res = await get("../img/krok-3-proba.png");

    expect(res.status).toBe(404);
  });

  it("brak sesji ma pierwszenstwo przed proba wyjscia poza katalog", async () => {
    getSessionMock.mockResolvedValue(null);

    const res = await get("../manifest.ts");

    expect(res.status).toBe(401);
  });
});

describe("/api/pomoc/[name] — biala lista wzorca nazwy", () => {
  it.each([
    ["KROK-3-PROBA.PNG"],
    ["krok_3_proba.png"],
    ["krok-3-proba.png.ts"],
    ["manifest.ts"],
    ["krok-3-proba.jpg"],
    [".png"],
    [""],
  ])("odmawia %s", async (name) => {
    getSessionMock.mockResolvedValue(session);

    const res = await get(name);

    expect(res.status).toBe(404);
  });
});
