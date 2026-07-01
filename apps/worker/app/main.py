"""FastAPI skeleton for the wyceny worker service.

Runs on Railway (deployment wiring lands in a later task).

Local run:
    uv run uvicorn app.main:app --reload
"""

from fastapi import FastAPI
from pydantic import BaseModel

from app.amount_in_words import to_amount_in_words

app = FastAPI(title="wyceny-worker")


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


class AmountInWordsRequest(BaseModel):
    amount: float


class AmountInWordsResponse(BaseModel):
    words: str


@app.post("/amount-in-words")
def amount_in_words(request: AmountInWordsRequest) -> AmountInWordsResponse:
    return AmountInWordsResponse(words=to_amount_in_words(request.amount))
