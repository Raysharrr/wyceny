"""FastAPI skeleton for the wyceny worker service.

Runs on Railway (deployment wiring lands in a later task).

Local run:
    uv run uvicorn app.main:app --reload
"""

import base64
import logging
import os
import time
from datetime import UTC, datetime

from fastapi import Body, FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import app.rcn as rcn
import app.subject as subject
from app import kw as kw_core
import app.maps as maps
from app.amount_in_words import to_amount_in_words
from app.convert import ConversionError, docx_to_pdf

logger = logging.getLogger("uvicorn.error")

app = FastAPI(title="wyceny-worker")

# CORS: the KW upload posts directly from the browser (Vercel 4.5 MB body
# limit forces the web bypass — spec §Architektura). Scoped by origin, not
# by route; the only state-changing endpoints are token-gated anyway.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip()
        for o in os.environ.get("CORS_ALLOW_ORIGINS", "http://localhost:3000").split(",")
        if o.strip()
    ],
    allow_methods=["POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


# Plain `def` (not async): Starlette runs sync handlers in a threadpool, so the
# blocking soffice subprocess (up to 120 s) never parks the event loop — /health
# and concurrent requests stay responsive on the single-worker uvicorn.
@app.post("/convert-to-pdf")
def convert_to_pdf(docx: bytes = Body(default=b"")) -> Response:
    # Default b"" (not required `...`): an empty body must hit our 400 below,
    # not FastAPI's generic 422 field-required validation error.
    if not docx:
        raise HTTPException(status_code=400, detail="Puste żądanie — oczekiwano pliku DOCX.")
    try:
        pdf = docx_to_pdf(docx)
    except ConversionError as exc:
        # Handled HTTPExceptions are never logged by FastAPI — without this
        # line a conversion failure (incl. the soffice stderr the
        # ConversionError carries) leaves no trace in Railway logs.
        logging.getLogger("uvicorn.error").error("convert-to-pdf failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Konwersja DOCX do PDF nie powiodła się — spróbuj ponownie.",
        ) from exc
    return Response(content=pdf, media_type="application/pdf")


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


class SubjectProposalRequest(BaseModel):
    address: str


class SubjectParcel(BaseModel):
    parcelId: str
    obreb: str
    arkusz: str
    nrDzialki: str
    powEwidHa: float | None
    uzytek: str


class SubjectBuilding(BaseModel):
    rodzaj: str
    kondygnacjeNadziemne: int | None
    kondygnacjePodziemne: int | None


class SubjectMpzp(BaseModel):
    symbol: str
    nazwaPlanu: str
    uchwala: str
    dataUchwaly: str
    publikator: str


class SubjectMeta(BaseModel):
    x: float
    y: float
    teryt: str
    fetchedAt: str
    source: str
    mpzpAbsent: bool


class SubjectProposalResponse(BaseModel):
    parcel: SubjectParcel
    building: SubjectBuilding | None
    mpzp: SubjectMpzp | None
    meta: SubjectMeta


OUT_OF_COVERAGE_DETAIL = "Dane przedmiotu dostępne na razie dla Poznania — wpisz dane ręcznie."
SUBJECT_FAILED_DETAIL = (
    "Nie udało się pobrać danych przedmiotu — spróbuj ponownie albo wpisz dane ręcznie."
)


@app.post("/subject-proposal")
def subject_proposal(request: SubjectProposalRequest) -> SubjectProposalResponse:
    try:
        geo = subject.geocode_address(request.address)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=SUBJECT_FAILED_DETAIL) from exc

    # 422 = out of MVP coverage (decision 9: non-retryable, distinct from 502)
    if not subject.is_poznan(geo.get("teryt")):
        raise HTTPException(status_code=422, detail=OUT_OF_COVERAGE_DETAIL)

    try:
        x, y = geo["x"], geo["y"]
        parcel_ref = subject.fetch_parcel_by_xy(x, y)
        parcel = subject.parcel_from_xml(subject.fetch_egib_xml("dzialki", x, y))
        if parcel is None:
            raise RuntimeError("EGiB nie zwróciło działki")
        building = subject.building_from_xml(subject.fetch_egib_xml("budynki", x, y))
        wkt_2180 = subject.fetch_parcel_wkt(parcel_ref["parcel_id"], 2180)
        function = subject.pick_mpzp_function(wkt_2180, subject.fetch_mpzp_functions(wkt_2180))
        lon, lat = subject.centroid_4326(subject.fetch_parcel_wkt(parcel_ref["parcel_id"], 4326))
        plan = subject.pick_plan(lon, lat, subject.fetch_plans())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=SUBJECT_FAILED_DETAIL) from exc

    mpzp = None
    if function or plan:
        mpzp = SubjectMpzp(
            symbol=(function or {}).get("symbol", ""),
            nazwaPlanu=(plan or {}).get("nazwa", ""),
            uchwala=(plan or {}).get("uchwala", ""),
            dataUchwaly=(plan or {}).get("data", ""),
            publikator=(plan or {}).get("publ", ""),
        )
    return SubjectProposalResponse(
        parcel=SubjectParcel(
            parcelId=parcel["parcel_id"],
            obreb=parcel["obreb"],
            arkusz=parcel["arkusz"],
            nrDzialki=parcel["nr_dzialki"],
            powEwidHa=parcel["pow_ewid_ha"],
            uzytek=parcel["uzytek"],
        ),
        building=SubjectBuilding(
            rodzaj=building["rodzaj"],
            kondygnacjeNadziemne=building["kondygnacje_nadziemne"],
            kondygnacjePodziemne=building["kondygnacje_podziemne"],
        )
        if building
        else None,
        mpzp=mpzp,
        meta=SubjectMeta(
            x=x,
            y=y,
            teryt=geo["teryt"],
            fetchedAt=datetime.now(UTC).isoformat(),
            source="geopoz-gugik",
            mpzpAbsent=mpzp is None,
        ),
    )


class MapProposalRequest(BaseModel):
    address: str


class MapProposalResponse(BaseModel):
    ewidencyjna: str  # base64 PNG (KIEG cadastral map)
    orto: str  # base64 JPEG (orthophoto)
    parcelId: str
    fetchedAt: str


MAPS_OUT_OF_COVERAGE_DETAIL = "Mapy do operatu dostępne na razie dla Poznania."
MAPS_FAILED_DETAIL = "Nie udało się pobrać map z Geoportalu — spróbuj ponownie."


@app.post("/map-proposal")
def map_proposal(request: MapProposalRequest) -> MapProposalResponse:
    try:
        geo = subject.geocode_address(request.address)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=MAPS_FAILED_DETAIL) from exc

    # 422 = out of MVP coverage (same non-retryable contract as /subject-proposal)
    if not subject.is_poznan(geo.get("teryt")):
        raise HTTPException(status_code=422, detail=MAPS_OUT_OF_COVERAGE_DETAIL)

    try:
        parcel_ref = subject.fetch_parcel_by_xy(geo["x"], geo["y"])
        wkt_2180 = subject.fetch_parcel_wkt(parcel_ref["parcel_id"], 2180)
        bbox_ewid, bbox_orto = maps.map_bboxes(wkt_2180)
        ewid = maps.fetch_map(
            maps.getmap_url(maps.KIEG_URL, maps.KIEG_LAYERS, bbox_ewid, "image/png")
        )
        orto = maps.fetch_map(maps.getmap_url(maps.ORTO_URL, "Raster", bbox_orto, "image/jpeg"))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=MAPS_FAILED_DETAIL) from exc

    return MapProposalResponse(
        ewidencyjna=base64.b64encode(ewid).decode("ascii"),
        orto=base64.b64encode(orto).decode("ascii"),
        parcelId=parcel_ref["parcel_id"],
        fetchedAt=datetime.now(UTC).isoformat(),
    )


class KwExtractResponse(BaseModel):
    extract: kw_core.KwExtractPayload
    docTypeDetected: str
    typeMismatch: bool
    model: str


KW_MODEL = "claude-sonnet-5"


def kw_max_bytes() -> int:
    # Seam for tests (shrinking the limit beats allocating 32 MB fixtures).
    return kw_core.MAX_PDF_BYTES


def _extract_kw_payload(pdf_b64: str) -> kw_core.KwExtractPayload:
    """The ONLY anthropic touchpoint — monkeypatched in every CI test.
    thinking disabled: spike showed identical quality, pure-JSON output."""
    import anthropic

    client = anthropic.Anthropic()  # ANTHROPIC_API_KEY from worker env (Railway secret)
    response = client.messages.parse(
        model=KW_MODEL,
        max_tokens=4096,
        thinking={"type": "disabled"},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_b64,
                        },
                    },
                    {"type": "text", "text": kw_core.EXTRACTION_PROMPT},
                ],
            }
        ],
        output_format=kw_core.KwExtractPayload,
    )
    if response.parsed_output is None:
        raise RuntimeError(f"kw extraction returned no parsed output ({response.stop_reason})")
    return response.parsed_output


@app.post("/kw-extract")
def kw_extract(
    file: UploadFile = File(...),
    token: str = Form(...),
    expected_type: str = Form(...),
) -> KwExtractResponse:
    secret = os.environ.get("WORKER_SHARED_SECRET", "")
    if not secret or not kw_core.verify_token(token, secret, time.time()):
        raise HTTPException(
            status_code=401,
            detail="Nieprawidłowy lub wygasły token — odśwież stronę i spróbuj ponownie.",
        )
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=415, detail="Obsługiwane są wyłącznie pliki PDF.")
    data = file.file.read()
    if len(data) > kw_max_bytes():
        raise HTTPException(status_code=413, detail="Plik jest za duży (limit 32 MB).")

    try:
        payload = _extract_kw_payload(base64.standard_b64encode(data).decode())
    except Exception as exc:
        logger.error("kw extraction failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Nie udało się odczytać dokumentu — spróbuj ponownie albo wpisz dane ręcznie.",
        ) from exc
    # File bytes are never persisted or logged: `data` dies with this request.

    if payload.docType == "nieznany":
        raise HTTPException(
            status_code=422,
            detail="To nie wygląda na akt notarialny ani odpis księgi wieczystej.",
        )

    payload = kw_core.scrub_extract(payload)
    if payload.docType == "akt" and payload.kwLokalu is None:
        payload = payload.model_copy(update={"deweloperski": True})

    return KwExtractResponse(
        extract=payload,
        docTypeDetected=payload.docType,
        typeMismatch=payload.docType != expected_type,
        model=KW_MODEL,
    )
