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
    price_trend,
    validate_numbers,
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
        "trend_cen": "stabilne",
    },
}


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
        assert data["proba"]["trend_cen"] == "stabilne"

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
        assert '\n  "trend_cen": "stabilne"' in tail  # nested level = 2 spaces
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


def tx(date: str, price: float) -> dict:
    return {"data": date, "cena_m2": price}


class TestPriceTrend:
    def test_rising(self):
        assert (
            price_trend(
                [
                    tx("01-2024", 9000.0),
                    tx("02-2024", 9100.0),
                    tx("03-2024", 10000.0),
                    tx("04-2024", 10500.0),
                ]
            )
            == "wzrostowe"
        )

    def test_falling(self):
        assert (
            price_trend(
                [
                    tx("01-2024", 10500.0),
                    tx("02-2024", 10000.0),
                    tx("03-2024", 9100.0),
                    tx("04-2024", 9000.0),
                ]
            )
            == "spadkowe"
        )

    def test_stable_below_threshold(self):
        # halves: 9050 vs 9175 -> +1,4% < 5%
        assert (
            price_trend(
                [
                    tx("01-2024", 9000.0),
                    tx("02-2024", 9100.0),
                    tx("03-2024", 9150.0),
                    tx("04-2024", 9200.0),
                ]
            )
            == "stabilne"
        )

    def test_dates_sorted_chronologically_not_lexicographically(self):
        # Regression: "02-2025" < "11-2024" lexicographically but is LATER in time.
        # Lexicographic order would report "spadkowe" here.
        data = [tx("11-2024", 9000.0), tx("02-2025", 12000.0)]
        assert price_trend(data) == "wzrostowe"
        assert price_trend(list(reversed(data))) == "wzrostowe"

    def test_odd_count_middle_goes_to_second_half(self):
        # spec split [100] vs [106, 106] -> +6% wzrostowe;
        # putting the middle in the FIRST half would give +2,9% -> "stabilne".
        assert (
            price_trend([tx("01-2024", 100.0), tx("02-2024", 106.0), tx("03-2024", 106.0)])
            == "wzrostowe"
        )

    def test_empty_and_single_transaction_are_stable(self):
        assert price_trend([]) == "stabilne"
        assert price_trend([tx("05-2025", 11000.0)]) == "stabilne"

    def test_threshold_boundaries_are_inclusive_upward(self):
        # delta == +prog -> wzrostowe, delta == -prog -> spadkowe (asymmetry is intentional)
        assert price_trend([tx("01-2024", 100.0), tx("02-2024", 105.0)]) == "wzrostowe"
        assert price_trend([tx("01-2024", 100.0), tx("02-2024", 95.0)]) == "spadkowe"

    def test_custom_threshold(self):
        data = [tx("01-2024", 100.0), tx("02-2024", 113.0)]
        assert price_trend(data) == "wzrostowe"
        assert price_trend(data, prog=0.2) == "stabilne"

    def test_zero_baseline_is_stable(self):
        assert price_trend([tx("01-2024", 0.0), tx("02-2024", 0.0)]) == "stabilne"

    def test_malformed_date_raises(self):
        with pytest.raises(ValueError):
            price_trend([tx("2024-01", 9000.0), tx("2024-02", 9500.0)])


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
