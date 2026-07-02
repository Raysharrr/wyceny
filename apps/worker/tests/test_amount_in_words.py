import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.amount_in_words import to_amount_in_words

client = TestClient(app)


def test_amount_in_words_returns_polish_words_not_number():
    r = client.post("/amount-in-words", json={"amount": 1044400})
    assert r.status_code == 200
    words = r.json()["words"]
    assert "tysięcy" in words or "tysiące" in words
    assert "złot" in words  # złotych
    assert "1044400" not in words  # F-11: never echoes the number


# Golden cases for `to_amount_in_words` (F-11). 540000 and 1044400 are the
# pre-existing baseline (no bare interior scale word — must stay unchanged
# by the interior-jeden fix). The rest pin the interior/leading "jeden"
# grammar fix: a bare thousand/million unit (implicit count of one) gets
# "jeden" whether it's the leading component or an interior one — e.g.
# 1_001_000 is "milion" (x1, bare) + "tysiąc" (x1, bare), both fixed.
@pytest.mark.parametrize(
    ("amount", "expected"),
    [
        # Baseline — no bare scale word involved, unaffected by this fix.
        (540000, "pięćset czterdzieści tysięcy złotych zero groszy"),
        (1044400, "jeden milion czterdzieści cztery tysiące czterysta złotych zero groszy"),
        # Interior-unit fix: bare "tysiąc" after a bare/counted "milion".
        (1001000, "jeden milion jeden tysiąc złotych zero groszy"),
        (2001000, "dwa miliony jeden tysiąc złotych zero groszy"),
        (1001001, "jeden milion jeden tysiąc jeden złoty zero groszy"),
        # Leading-only bare unit (pre-existing behaviour, still correct).
        (1000, "jeden tysiąc złotych zero groszy"),
        (2000, "dwa tysiące złotych zero groszy"),
        (1000000, "jeden milion złotych zero groszy"),
        (2000000, "dwa miliony złotych zero groszy"),
    ],
)
def test_amount_in_words_golden_cases(amount: int, expected: str) -> None:
    assert to_amount_in_words(amount) == expected
