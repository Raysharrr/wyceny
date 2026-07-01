"""FastAPI skeleton for the wyceny worker service.

Runs on Railway (deployment wiring lands in a later task).

Local run:
    uv run uvicorn app.main:app --reload
"""

from fastapi import FastAPI
from pydantic import BaseModel

from app.slownie import to_slownie

app = FastAPI(title="wyceny-worker")


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


class SlownieRequest(BaseModel):
    amount: float


class SlownieResponse(BaseModel):
    words: str


@app.post("/slownie")
def slownie(request: SlownieRequest) -> SlownieResponse:
    return SlownieResponse(words=to_slownie(request.amount))
