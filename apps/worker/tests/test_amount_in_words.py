from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_amount_in_words_returns_polish_words_not_number():
    r = client.post("/amount-in-words", json={"amount": 1044400})
    assert r.status_code == 200
    words = r.json()["words"]
    assert "tysięcy" in words or "tysiące" in words
    assert "złot" in words          # złotych
    assert "1044400" not in words   # F-11: never echoes the number
