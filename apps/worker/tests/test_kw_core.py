"""KW core unit tests (Slice 6 Task 2). F-9: scrub must strip PESELs and
person-context fragments before anything leaves the worker. All fixtures are
SYNTHETIC — no real KW numbers (F-9 regex-breaking shapes only), no real names.
"""

import hashlib
import hmac

from app.kw import EXTRACTION_PROMPT, KwDzial, KwExtractPayload, scrub_extract, verify_token

# F-9: PESEL-like fixtures are BUILT AT RUNTIME from split literals so this
# committed file never contains an 11-digit run (scripts/check-no-pii.sh).
PESEL_A = "85010" + "112345"
PESEL_B = "90020" + "254321"


def payload(**overrides) -> KwExtractPayload:
    base = dict(
        docType="odpis_kw",
        kwLokalu=None,
        kwGruntu=None,
        kwInne=[],
        deweloperski=False,
        powUzytkowaKw=None,
        powPrzezOdwolanie=False,
        udzial=None,
        sad=None,
        wydzial=None,
        dataDokumentu=None,
        dzial3=None,
        dzial4=None,
    )
    base.update(overrides)
    return KwExtractPayload(**base)


class TestScrub:
    def test_pesel_removed_from_dzial_tresc(self):
        p = payload(dzial3=KwDzial(wpisy=True, tresc=[f"roszczenie, PESEL {PESEL_A}, o wpis"]))
        out = scrub_extract(p)
        assert PESEL_A not in out.dzial3.tresc[0]
        assert out.dzial3.wpisy is True

    def test_person_context_fragment_removed(self):
        # "PESEL"/"urodzony"/"syn"/"córka" mark person fragments — cut to next delimiter.
        p = payload(
            dzial4=KwDzial(wpisy=True, tresc=["hipoteka umowna, syn Jana, kwota 200000 zł"])
        )
        out = scrub_extract(p)
        assert "Jana" not in out.dzial4.tresc[0]
        assert "hipoteka umowna" in out.dzial4.tresc[0]
        assert "kwota 200000 zł" in out.dzial4.tresc[0]

    def test_institution_entries_survive(self):
        entry = "hipoteka umowna — Bank Przykładowy S.A., 350000 zł"
        p = payload(dzial4=KwDzial(wpisy=True, tresc=[entry]))
        assert scrub_extract(p).dzial4.tresc[0] == entry

    def test_scrub_covers_sad_and_udzial(self):
        p = payload(sad=f"Sąd Rejonowy PESEL {PESEL_B}", udzial=f"1/2 PESEL {PESEL_B}")
        out = scrub_extract(p)
        assert PESEL_B not in out.sad
        assert PESEL_B not in out.udzial

    def test_none_fields_pass_through(self):
        out = scrub_extract(payload())
        assert out.dzial3 is None and out.sad is None

    def test_abbreviated_birth_date_removed(self):
        # Amendment: "ur. 1 stycznia 1980" fragment should be removed.
        p = payload(
            dzial3=KwDzial(
                wpisy=True, tresc=["usprawiedliwienie, ur. 1 stycznia 1980, dalszy tekst"]
            )
        )
        out = scrub_extract(p)
        assert "1 stycznia 1980" not in out.dzial3.tresc[0]
        assert "usprawiedliwienie" in out.dzial3.tresc[0]
        assert "dalszy tekst" in out.dzial3.tresc[0]

    def test_spaced_pesel_after_marker_removed(self):
        # Amendment: "PESEL 850101 12345" (spaced 11-digit-run) removed by context rule.
        # Build the digits at runtime to avoid 11-digit runs in committed file.
        pesel_spaced = "PESEL 85010" + "1 12345"
        p = payload(dzial4=KwDzial(wpisy=True, tresc=[f"hipoteka, {pesel_spaced}, kwota"]))
        out = scrub_extract(p)
        # The spaced PESEL should be removed by the context rule (from PESEL marker to next delimiter)
        assert "850101" not in out.dzial4.tresc[0]
        # At least the context rule should have scrubbed something
        assert "[dane osobowe usunięte]" in out.dzial4.tresc[0]


class TestToken:
    SECRET = "test-secret"

    def _mint(self, exp: int, nonce: str = "abcd1234", secret: str | None = None) -> str:
        s = secret or self.SECRET
        sig = hmac.new(s.encode(), f"{exp}.{nonce}".encode(), hashlib.sha256).hexdigest()
        return f"{exp}.{nonce}.{sig}"

    def test_valid_token_accepted(self):
        assert verify_token(self._mint(exp=2000), self.SECRET, now=1000.0) is True

    def test_expired_token_rejected(self):
        assert verify_token(self._mint(exp=500), self.SECRET, now=1000.0) is False

    def test_wrong_secret_rejected(self):
        assert verify_token(self._mint(exp=2000, secret="other"), self.SECRET, now=1000.0) is False

    def test_malformed_token_rejected(self):
        assert verify_token("not-a-token", self.SECRET, now=1000.0) is False
        assert verify_token("1.2", self.SECRET, now=1000.0) is False


class TestPrompt:
    def test_prompt_bans_persons_and_asks_for_institutions(self):
        # The prompt is the FIRST scrub layer — pin its load-bearing clauses.
        assert "osób fizycznych" in EXTRACTION_PROMPT or "osoby fizyczne" in EXTRACTION_PROMPT
        assert "PESEL" in EXTRACTION_PROMPT
        assert "instytucj" in EXTRACTION_PROMPT
