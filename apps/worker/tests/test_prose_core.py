"""Prose core unit tests (prose slice, Task 2). Pure — no network, no API key.

F-9: every fixture is SYNTHETIC (ul. Klonowa / ul. Brzozowa, m. Nowogród — the
same fictional world the committed prompts use). No addresses or prices from
real operat documents.
"""

import json
import re
from pathlib import Path

import pytest

import app.prose
from app.prose import (
    PROMPTS_DIR,
    SECTIONS,
    build_prompt,
    parse_section_file,
    validate_numbers,
    validate_obreby,
)

# Synthetic facts in the shape the prompts document (F-9: fictional world only).
FACTS_RYNEK = {
    "adres": "ul. Klonowa 14/3, Nowogród",
    "obreb": "0007 Zarzecze",
    "pow_uzytkowa": "68,40",
    "proba": {
        "liczba_transakcji": 14,
        "zakres_dat": "03-2024 – 11-2025",
        "cena_min_zl_m2": "9 240,00",
        "cena_srednia_zl_m2": "10 815,00",
        "cena_max_zl_m2": "12 480,00",
        "obreby": ["Zarzecze", "Podgórze"],
        "promien_m": 1000,
        "przebadano": "kilkaset",
    },
}


# Zero na sześć operatów wzorcowych (5 KCS w repo + Winiary) orzeka o kierunku
# cen, a operaty metodą porównywania parami robią z tej odmowy osobne zdanie:
# „nie jest możliwym stwierdzenie, czy rynek odpowiada na aktualną sytuację
# wzrostem czy stagnacją cen". To konwencja zawodowa, nie przeoczenie — prompt
# nie może wymuszać twierdzenia, którego rzeczoznawca nie stawia.
FORBIDDEN_TREND_WORDS = ("tendencj", "wzrostow", "spadkow", "wzrost cen", "spadek cen")


def test_prompt_analiza_rynku_nie_kaze_orzekac_o_trendzie():
    text = (PROMPTS_DIR / "analiza_rynku.md").read_text(encoding="utf-8").lower()
    for word in FORBIDDEN_TREND_WORDS:
        assert word not in text, f"prompt wciąż mówi o trendzie: {word!r}"


def test_fakty_proby_nie_niosa_trend_cen():
    prompt = build_prompt("analiza_rynku", FACTS_RYNEK)
    assert "trend_cen" not in prompt


def test_liczba_przebadanych_transakcji_jest_slowem_nie_sztuka():
    """Aneta: „niech nie wpisuje konkretnej liczby tylko kilkadziesiąt lub
    kilkaset zależy ile ich ściągnie". Słowo liczy web (`approximateCount`),
    prompt ma je tylko przepisać — i pokazać wzorzec w obu few-shotach."""
    text = (PROMPTS_DIR / "analiza_rynku.md").read_text(encoding="utf-8")
    assert "kilkadziesiąt" in text and "kilkaset" in text

    _, examples = parse_section_file(PROMPTS_DIR / "analiza_rynku.md")
    for facts, answer in examples:
        przebadano = facts["proba"]["przebadano"]
        assert isinstance(przebadano, str), "dokładna liczba rozszerzyłaby straż liczb"
        assert przebadano in answer

        # Liczba przyjętych do porównań zostaje dokładna — trafia do Tabeli 1.
        assert str(facts["proba"]["liczba_transakcji"]) in answer


class TestParseSectionFile:
    def test_all_production_sections_parse(self):
        # The 6 committed prompts are the parser's contract: task + >=1 example,
        # every example a DANE dict plus a non-empty TEKST.
        for section in SECTIONS:
            task, examples = parse_section_file(PROMPTS_DIR / f"{section}.md")
            assert task.strip(), f"{section}: empty ZADANIE"
            assert len(examples) >= 1, f"{section}: no examples"
            for data, text in examples:
                assert isinstance(data, dict) and data, f"{section}: empty DANE"
                assert text.strip(), f"{section}: empty TEKST"

    def test_section_files_exist_for_every_declared_section(self):
        assert SECTIONS == (
            "analiza_rynku",
            "opis_lokalu",
            "otoczenie",
            "zagospodarowanie",
            "standard",
            "uzasadnienie",
        )
        for section in SECTIONS:
            assert (PROMPTS_DIR / f"{section}.md").is_file()

    def test_example_data_is_parsed_json(self):
        _, examples = parse_section_file(PROMPTS_DIR / "analiza_rynku.md")
        data, _ = examples[0]
        assert data["proba"]["zakres_dat"] == "03-2024 – 11-2025"

    def test_missing_task_raises(self, tmp_path):
        path = tmp_path / "broken.md"
        path.write_text('## PRZYKŁAD\n\n### DANE\n\n```json\n{"a": 1}\n```\n\n### TEKST\n\nx\n')
        with pytest.raises(ValueError):
            parse_section_file(path)

    def test_no_examples_raises(self, tmp_path):
        path = tmp_path / "broken.md"
        path.write_text("## ZADANIE\n\nNapisz coś.\n")
        with pytest.raises(ValueError):
            parse_section_file(path)


class TestBuildPrompt:
    # The layout below was validated end-to-end in the spike — changing any of
    # these literal separators invalidates that validation, so they are pinned.
    def test_layout_style_task_examples_data(self):
        prompt = build_prompt("analiza_rynku", FACTS_RYNEK)
        style = (PROMPTS_DIR / "_style.md").read_text(encoding="utf-8").strip()
        task, examples = parse_section_file(PROMPTS_DIR / "analiza_rynku.md")

        assert prompt.startswith(style)
        assert f"{style}\n\nZADANIE: {task}\n\n" in prompt
        assert prompt.count("PRZYKŁAD — DANE:\n") == len(examples) >= 2
        assert prompt.count("\nPRZYKŁAD — TEKST SEKCJI:\n") == len(examples)
        assert "\n\nDANE:\n" in prompt
        assert prompt.endswith("\nTEKST SEKCJI:")

    def test_layout_is_byte_identical_to_the_validated_assembly(self):
        # review finding M-1. The `in`/`startswith` assertions above pass even
        # when the separators BETWEEN example blocks change — a mutation to a
        # single "\n" or to indent=2 left the suite green. The prompts shipped
        # here were validated empirically (18 generations, K1-K4) against ONE
        # exact assembly; if production drifts from it, that evidence no longer
        # covers production. So reconstruct the whole string from the parsed
        # parts and demand full equality — this is the layout's only real lock.
        section, facts = "analiza_rynku", FACTS_RYNEK
        style = (PROMPTS_DIR / "_style.md").read_text(encoding="utf-8").strip()
        task, examples = parse_section_file(PROMPTS_DIR / f"{section}.md")
        blocks = "\n\n".join(
            "PRZYKŁAD — DANE:\n"
            + json.dumps(data, indent=1, ensure_ascii=False)
            + "\nPRZYKŁAD — TEKST SEKCJI:\n"
            + text
            for data, text in examples
        )
        expected = (
            f"{style}\n\nZADANIE: {task}\n\n"
            + blocks
            + "\n\nDANE:\n"
            + json.dumps(facts, indent=1, ensure_ascii=False)
            + "\nTEKST SEKCJI:"
        )
        assert build_prompt(section, facts) == expected

    def test_sections_appear_in_order(self):
        prompt = build_prompt("analiza_rynku", FACTS_RYNEK)
        assert (
            prompt.index("\n\nZADANIE: ")
            < prompt.index("PRZYKŁAD — DANE:\n")
            < prompt.index("\n\nDANE:\n")
            < prompt.index("\nTEKST SEKCJI:")
        )

    def test_facts_serialized_with_indent_one_and_polish_chars(self):
        prompt = build_prompt("analiza_rynku", FACTS_RYNEK)
        tail = prompt[prompt.index("\n\nDANE:\n") :]
        assert '\n "adres": "ul. Klonowa 14/3, Nowogród"' in tail  # indent=1, ensure_ascii=False
        assert '\n  "cena_max_zl_m2": "12 480,00"' in tail  # nested level = 2 spaces
        assert "\\u" not in tail

    def test_example_text_included_verbatim(self):
        prompt = build_prompt("analiza_rynku", FACTS_RYNEK)
        _, examples = parse_section_file(PROMPTS_DIR / "analiza_rynku.md")
        for data, text in examples:
            assert text in prompt
            assert data["adres"] in prompt

    def test_every_section_builds(self):
        for section in SECTIONS:
            prompt = build_prompt(section, {"adres": "ul. Brzozowa 8/21, Nowogród"})
            assert prompt.endswith("\nTEKST SEKCJI:")
            assert "ul. Brzozowa 8/21, Nowogród" in prompt

    def test_unknown_section_raises_value_error(self):
        with pytest.raises(ValueError):
            build_prompt("nie_ma_takiej", FACTS_RYNEK)

    def test_unknown_section_cannot_escape_prompts_dir(self):
        # Section name is used to build a path — only the closed set is allowed.
        with pytest.raises(ValueError):
            build_prompt("../../main", FACTS_RYNEK)


# Facts for the number guard — synthetic, shaped like a real section payload
# (nested dict + list of transactions, PL number formatting).
FACTS_GUARD = {
    "adres": "ul. Klonowa 14/3, Nowogród",
    "pow_uzytkowa": "68,40",
    "proba": {
        "liczba_transakcji": 14,
        "zakres_dat": "03-2024 – 11-2025",
        "cena_min_zl_m2": "9 240,00",
        "cena_max_zl_m2": "12 480,00",
    },
    "transakcje": [
        {"data": "05-2025", "cena_m2": "11 111,94"},
        {"data": "07-2025", "cena_m2": "10 500,00"},
    ],
}


class TestValidateNumbers:
    def test_text_using_only_facts_is_clean(self):
        text = (
            "W próbie znalazło się 14 transakcji z okresu 03-2024 – 11-2025. "
            "Jednostkowe ceny transakcyjne znajdowały się w przedziale od 9 240,00 zł "
            "do 12 480,00 zł za 1 m2 powierzchni użytkowej lokalu o powierzchni 68,40 m2, "
            "położonego przy ul. Klonowa 14/3."
        )
        assert validate_numbers(text, FACTS_GUARD) == []

    def test_injected_foreign_number_is_caught(self):
        # Mutation test — the guard's whole reason to exist.
        text = "W próbie znalazło się 99 transakcji."
        assert validate_numbers(text, FACTS_GUARD) == ["99"]

    def test_idiom_za_1_m2_is_allowed(self):
        # "1" in "za 1 m2" is the only number allowed outside DANE (style rule 4).
        assert validate_numbers("Cena 9 240,00 zł za 1 m2 powierzchni.", FACTS_GUARD) == []
        assert validate_numbers("Cena 9 240,00 zł za 1 m² powierzchni.", FACTS_GUARD) == []

    def test_digit_in_unit_is_not_a_fact(self):
        facts = {"pow_uzytkowa": "45,70"}
        assert validate_numbers("Powierzchnia użytkowa wynosi 45,70 m2.", facts) == []
        assert validate_numbers("Powierzchnia użytkowa wynosi 45,70 m².", facts) == []

    def test_number_broken_across_a_line_is_not_a_violation(self):
        text = "Cena transakcyjna wyniosła 11 111,\n94 zł za 1 m2."
        assert validate_numbers(text, FACTS_GUARD) == []

    def test_number_from_a_list_in_facts_is_allowed(self):
        text = "Odnotowano transakcję w cenie 10 500,00 zł za 1 m2 w okresie 07-2025."
        assert validate_numbers(text, FACTS_GUARD) == []

    def test_numeric_and_nested_fact_values_are_allowed(self):
        facts = {"proba": {"liczba_transakcji": 14, "cena_srednia_zl_m2": 10815.5}}
        assert validate_numbers("Średnia z 14 transakcji to 10815,5 zł.", facts) == []

    def test_several_violations_are_all_reported(self):
        text = "W próbie znalazło się 99 transakcji z 7 obrębów."
        assert validate_numbers(text, FACTS_GUARD) == ["99", "7"]

    def test_empty_text_is_clean(self):
        assert validate_numbers("", FACTS_GUARD) == []

    def test_text_without_facts_reports_every_number(self):
        assert validate_numbers("Lokal o powierzchni 68,40 m2.", {}) == ["68,40"]

    def test_comma_plus_space_still_separates_two_numbers(self):
        # Pins the line-break fix scope: only a line break joins a decimal.
        # A comma + space is a list separator, so a foreign second number is caught.
        facts = {"zakres_dat": "03-2024 – 11-2025"}
        assert validate_numbers("Transakcje z lat 2024, 2019.", facts) == ["2019"]

    # --- review finding I-1: joining a line-broken decimal must be CONDITIONAL.
    # Joining unconditionally let an invented number hide behind a line break —
    # "2024,\n2019" collapsed into "2024,2019", whose integer part "2024" IS a
    # fact, so the lenient fallback waved the whole thing through. These are the
    # counterexamples found in review; they go red if the condition is dropped.
    def test_line_break_does_not_launder_a_foreign_year(self):
        facts = {"proba": {"zakres_dat": "03-2024 – 11-2024"}}
        assert validate_numbers("Transakcje pochodzą z lat 2024,\n2019.", facts) == ["2019"]

    def test_line_break_does_not_launder_a_foreign_count(self):
        facts = {"proba": {"liczba_transakcji": 14}}
        assert validate_numbers("W próbie 14,\n99 transakcji.", facts) == ["99"]

    def test_windows_line_break_joins_a_factual_decimal(self):
        # \r\n is a line break too — the join must not depend on the platform.
        facts = {"cena": "11 111,94"}
        assert validate_numbers("Cena wyniosła 11 111,\r\n94 zł.", facts) == []

    def test_dashed_float_repr_does_not_widen_the_allowed_set(self):
        # review m-3: the spike split dashed tokens into components, so a fact of
        # 1e-05 (repr "1e-05") licensed "05" anywhere in the operat. The split is
        # gone; the guard must no longer accept a number it never received.
        assert validate_numbers("W obrębie 05 odnotowano transakcje.", {"x": 1e-05}) == ["05"]


class TestNoApiSurface:
    def test_module_does_not_import_anthropic(self):
        # T2 is pure: the single anthropic touchpoint lives in main.py (T3).
        source = Path(app.prose.__file__).read_text(encoding="utf-8")
        assert not re.search(r"^\s*(?:import|from)\s+anthropic\b", source, re.MULTILINE)

    def test_categorical_result_position_passes_through(self):
        # F-11: the worker never sees a market value — `pozycja_wyniku` is a
        # categorical string computed on the web side, and carries no number.
        facts = {"pozycja_wyniku": "w przedziale cen próby, powyżej średniej"}
        prompt = build_prompt("uzasadnienie", facts)
        assert "w przedziale cen próby, powyżej średniej" in prompt
        assert validate_numbers("Wynik mieści się w przedziale cen próby.", facts) == []


class TestGuardAcceptsOnlyExactForms:
    """The guard's one job: a number in the operat must be a number from the data.

    The ported evaluator accepted a number whose INTEGER PART was a fact, which
    let an invented decimal through — with an area of "71,63" it passed
    "71,99 m2", i.e. a different flat, stated as fact in a document with legal
    effects. Found by an evidence-based audit of the Help module, reproduced by
    running the guard, and closed here. Re-evaluating the 18 recorded validation
    generations under the strict rule gave ZERO violations: the tolerance was
    carrying risk, not output.
    """

    FACTS = {
        "pow_uzytkowa": "71,63",
        "proba": {"cena_srednia_zl_m2": "13 123,60", "liczba_transakcji": 12},
    }

    def test_invented_decimals_behind_a_factual_integer_part_are_caught(self):
        assert validate_numbers("Lokal ma 71,99 m2.", self.FACTS) == ["71,99"]
        assert validate_numbers("Średnia to 13 123,99 zł.", self.FACTS) == ["13 123,99"]

    def test_rounding_a_fact_away_is_caught_too(self):
        # "71" is not the area; 71,63 is. The style guide already demands the
        # exact written form, so honouring a rounded one only hid drift.
        assert validate_numbers("Lokal ma 71 m2.", self.FACTS) == ["71"]

    def test_exact_forms_still_pass(self):
        assert (
            validate_numbers("Lokal 71,63 m2, średnia 13 123,60 zł, 12 transakcji.", self.FACTS)
            == []
        )


class TestValidateObreby:
    """Slice 5. Aneta: „analizę opisał nam nie z tego obrębu ewidencyjnego".
    Nazwa obrębu nie niesie żadnej liczby, więc `validate_numbers` jest na nią
    ślepy — potrzebna osobna straż."""

    FACTS = {"obreb": "0007 Zarzecze", "proba": {"obreby": ["Golęcin", "Sołacz"]}}

    def test_lapie_obreb_spoza_faktow(self):
        text = "Zbadano rynek lokalny w obrębie Naramowice oraz w obrębach sąsiednich."
        assert validate_obreby(text, self.FACTS) == ["Naramowice"]

    def test_przepuszcza_obreby_z_proby(self):
        assert validate_obreby("Zbadano rynek w obrębach Golęcin i Sołacz.", self.FACTS) == []

    def test_przepuszcza_obreb_wycenianej_nieruchomosci(self):
        # Few-shot otwiera akapit obrębem PRZEDMIOTU wyceny — z pola `obreb`,
        # nie z próby. Straż, która go odrzuca, kasuje każdą poprawną generację.
        text = "Przeprowadzono analizę rynku m. Nowogród, obręb nr 0007 Zarzecze."
        assert validate_obreby(text, self.FACTS) == []

    def test_przepuszcza_odmienione_nazwy(self):
        # Polszczyzna odmienia nazwy własne; straż nie może karać za gramatykę.
        assert validate_obreby("Transakcje z obrębu Golęcina i z Sołacza.", self.FACTS) == []

    def test_nie_lapie_slow_pospolitych_po_slowie_obreb(self):
        assert validate_obreby("Badanie w obrębie jednego budynku.", self.FACTS) == []

    def test_bez_faktow_o_obrebach_kazda_nazwa_jest_naruszeniem(self):
        assert validate_obreby("Rynek w obrębie Naramowice.", {}) == ["Naramowice"]

    def test_pusty_tekst_i_brak_wzmianki(self):
        assert validate_obreby("", self.FACTS) == []
        assert validate_obreby("Ceny mieściły się w przedziale.", self.FACTS) == []

    def test_few_shoty_promptu_sa_czyste(self):
        # Regresja na samą straż: gdyby odrzucała poprawną polszczyznę, sekcja
        # byłaby trwale niewypełnialna, a testy syntetyczne by tego nie pokazały.
        _, examples = parse_section_file(PROMPTS_DIR / "analiza_rynku.md")
        for facts, answer in examples:
            assert validate_obreby(answer, facts) == []
