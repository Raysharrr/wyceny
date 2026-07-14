"""FastAPI skeleton for the wyceny worker service.

Runs on Railway (deployment wiring lands in a later task).

Local run:
    uv run uvicorn app.main:app --reload
"""

from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import app.rcn as rcn
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


class SampleProposalRequest(BaseModel):
    address: str
    area: float


class SampleTransaction(BaseModel):
    date: str
    area: float
    pricePerM2: float
    transactionId: str


class SampleProposalQuery(BaseModel):
    bbox: list[float]
    count: int
    sort: str


class SampleProposalMeta(BaseModel):
    lat: float
    lon: float
    fetchedAt: str
    source: str
    query: SampleProposalQuery


class SampleProposalResponse(BaseModel):
    transactions: list[SampleTransaction]
    meta: SampleProposalMeta


@app.post("/sample-proposal")
def sample_proposal(request: SampleProposalRequest) -> SampleProposalResponse:
    # I/O boundary: the clock is read here, never inside the pure core.
    today_month = datetime.now(UTC).strftime("%Y-%m")

    try:
        lat, lon = rcn.geocode(request.address)
        bbox = (lat - 0.018, lon - 0.029, lat + 0.018, lon + 0.029)
        gml = rcn.fetch_rcn(bbox)
        transactions = rcn.parse_gml(gml)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Nie udało się pobrać próby z RCN — spróbuj ponownie albo wpisz transakcje ręcznie.",
        ) from exc

    selection = rcn.select_sample(transactions, request.area, today_month)
    if len(selection) < 12:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Za mało transakcji w okolicy (znaleziono {len(selection)}) — "
                "zawęź adres albo uzupełnij próbę ręcznie."
            ),
        )

    return SampleProposalResponse(
        transactions=[
            SampleTransaction(
                date=t["date"],
                area=t["area"],
                pricePerM2=t["price_per_m2"],
                transactionId=t["transaction_id"],
            )
            for t in selection
        ],
        meta=SampleProposalMeta(
            lat=lat,
            lon=lon,
            fetchedAt=datetime.now(UTC).isoformat(),
            source="rcn-wfs-gugik",
            query=SampleProposalQuery(bbox=list(bbox), count=5000, sort="dok_data D"),
        ),
    )
