// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { HelpSearch } from "@/components/help/help-search";
import type { HelpIndexEntry } from "@/lib/help-search";

// vitest doesn't expose globals, so RTL's auto-cleanup never registers.
afterEach(cleanup);

const index: HelpIndexEntry[] = [
  {
    slug: "krok-3-proba",
    title: "Krok 3 — Próba",
    tree: "jak-korzystac",
    tags: [],
    text: "transakcje z rejestru RCN",
  },
];

describe("HelpSearch", () => {
  it("pokazuje trafienie po tresci", async () => {
    render(<HelpSearch index={index} />);
    await userEvent.type(screen.getByRole("searchbox"), "rejestru");
    expect(screen.getByRole("link", { name: /krok 3/i })).toHaveAttribute(
      "href",
      "/pomoc/krok-3-proba",
    );
  });

  it("informuje o braku wynikow", async () => {
    render(<HelpSearch index={index} />);
    await userEvent.type(screen.getByRole("searchbox"), "hipoteka");
    expect(screen.getByText(/brak wyników/i)).toBeInTheDocument();
  });

  // Bez tej asercji mozna usunac warunek `asked` i komponent nadal przechodzi
  // pozostale testy — a uzytkownik dostaje komunikat „Brak wyników" zanim
  // cokolwiek wpisze.
  it("milczy, dopoki nie ma zapytania", () => {
    render(<HelpSearch index={index} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/brak wyników/i)).not.toBeInTheDocument();
  });

  // Decyzja o hierarchii naglowkow: wyniki NIE dostaja wlasnego <h2>, wiec
  // dostepnosc opiera sie na landmarku `search` (nawigacja po landmarkach
  // zamiast po naglowkach) i na regionie `status`. Oba sa tu przypiete —
  // inaczej sama decyzja byloby czysta deklaracja.
  it("jest landmarkiem wyszukiwania", () => {
    render(<HelpSearch index={index} />);
    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  // Region live musi byc w DOM ZANIM dostanie tresc — jesli pojawia sie razem
  // z nia, czytniki ekranu zwykle nie oglaszaja niczego.
  it("ma region status obecny juz przed wpisaniem zapytania", async () => {
    render(<HelpSearch index={index} />);
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent("");
    await userEvent.type(screen.getByRole("searchbox"), "rejestru");
    expect(screen.getByRole("status")).toHaveTextContent(/1/);
  });

  // Usuniecie `<span>{TREE_LABEL[entry.tree]}</span>` zostawialo caly ten plik
  // zielony. Wlasny, dwuwpisowy indeks zamiast wspoldzielonego: asercja na
  // jednym wpisie przechodzi takze dla etykiety zaszytej na sztywno, a wpiecie
  // drugiego trafienia do `index` zepsulo by test regionu `status` (liczy 1).
  it("etykietuje trafienia drzewem, z ktorego pochodza", async () => {
    render(
      <HelpSearch
        index={[
          { slug: "a", title: "Krok 3", tree: "jak-korzystac", tags: [], text: "rejestru" },
          { slug: "b", title: "Operat", tree: "metodyka", tags: [], text: "rejestru" },
        ]}
      />,
    );
    await userEvent.type(screen.getByRole("searchbox"), "rejestru");
    expect(screen.getByText("Jak korzystać")).toBeInTheDocument();
    expect(screen.getByText("Na czym opieramy wynik")).toBeInTheDocument();
  });

  // Zakres: sam komponent, nie cala strona. Chodzi o to, ze wyniki nie
  // wnosza WLASNEGO naglowka — dzieki temu zarys naglowkow /pomoc (h1 +
  // po jednym h2 na drzewo) nie przestawia sie w trakcie pisania.
  it("nie renderuje wlasnego naglowka wynikow", async () => {
    render(<HelpSearch index={index} />);
    await userEvent.type(screen.getByRole("searchbox"), "rejestru");
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
  });
});
