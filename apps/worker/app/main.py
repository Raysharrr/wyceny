"""FastAPI skeleton for the wyceny worker service.

Runs on Railway (deployment wiring lands in a later task).

Local run:
    uv run uvicorn app.main:app --reload
"""

from fastapi import FastAPI

app = FastAPI(title="wyceny-worker")


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}
