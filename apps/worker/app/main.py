"""FastAPI skeleton for the wyceny worker service.

Runs on Railway (deployment wiring lands in a later task).

Local run:
    uv run uvicorn app.main:app --reload
"""

import base64
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import NamedTuple

from fastapi import Body, FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import app.rcn as rcn
import app.subject as subject
from app import kw as kw_core
import app.maps as maps
from app import photo as photo_core
from app import prose as prose_core
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


# Not "try again": the geocoder gave a definitive answer, and repeating the
# request repeats it. Only a corrected address changes the outcome.
ADDRESS_NOT_FOUND_DETAIL = (
    "Nie rozpoznano adresu nieruchomości — sprawdź jego pisownię "
    "(np. „ul. Główna 12, Poznań”) i popraw go w kroku 1."
)
OUT_OF_COVERAGE_DETAIL = "Dane przedmiotu dostępne na razie dla Poznania — wpisz dane ręcznie."
SUBJECT_FAILED_DETAIL = (
    "Nie udało się pobrać danych przedmiotu — spróbuj ponownie albo wpisz dane ręcznie."
)


@app.post("/subject-proposal")
def subject_proposal(request: SubjectProposalRequest) -> SubjectProposalResponse:
    try:
        geo = subject.geocode_address(request.address)
    except subject.AddressNotFound as exc:
        raise HTTPException(status_code=422, detail=ADDRESS_NOT_FOUND_DETAIL) from exc
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
    except subject.AddressNotFound as exc:
        raise HTTPException(status_code=422, detail=ADDRESS_NOT_FOUND_DETAIL) from exc
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


PROSE_MODEL = "claude-sonnet-5"
# Measured on the 18 validation generations: 3.71 output tokens per word, and
# the longest accepted section (analiza_rynku, 177 words) cost ~650 tokens.
# The validation itself ran at 1000, i.e. barely 1.5x headroom — and production
# facts are richer than the validation's. max_tokens is a CAP, not a
# reservation (billing follows usage.output_tokens), so raising it costs
# nothing and removes a failure mode that no retry can clear: identical facts
# produce an identically long text, so a truncation repeats forever.
PROSE_MAX_TOKENS = 2500


class ProseTransaction(BaseModel):
    """One sample transaction. Never reaches the prompt — it only feeds
    `prose.price_trend` (rule 2 of the T3 contract), so raw prices never widen
    the number guard's allowed set."""

    data: str  # "MM-RRRR"
    cena_m2: float


class ProseProposalRequest(BaseModel):
    token: str
    sekcje: list[str]
    fakty: dict
    transakcje: list[ProseTransaction] = Field(default_factory=list)


class ProseUsage(BaseModel):
    input_tokens: int
    output_tokens: int


class ProseProposalResponse(BaseModel):
    """F-11: no market value and no unit value of the result — section prose in,
    section prose out. `odrzucone` maps a section to the numbers the guard found
    outside the facts twice in a row; an EMPTY list there means the call itself
    failed. Either way that section is left for the appraiser to write by hand
    ("honest silence") instead of failing the whole request — the sections that
    did succeed are returned and stay paid for."""

    sekcje: dict[str, str]
    odrzucone: dict[str, list[str]]
    model: str
    usage: ProseUsage


class ProseCompletion(NamedTuple):
    text: str
    input_tokens: int
    output_tokens: int


def _generate_prose_section(
    section: str, prompt: str, correction: str | None = None
) -> ProseCompletion:
    """The ONLY anthropic touchpoint — monkeypatched in every CI test (ADR-009).

    `prompt` arrives pre-assembled by `prose.build_prompt`: that layout is what
    the empirical validation ran against, so a correction after a failed number
    guard goes in as a SEPARATE content block instead of reshaping it.
    thinking disabled: the prompts were validated on this exact pairing."""
    import anthropic

    client = anthropic.Anthropic()  # ANTHROPIC_API_KEY from worker env (Railway secret)
    # Content blocks concatenate, and the validated prompt ENDS at "TEKST SEKCJI:" —
    # the slot the model writes into. A correction appended after it would sit in
    # that slot; it goes in front, so the prompt still terminates the message.
    content: list[dict] = []
    if correction:
        content.append({"type": "text", "text": correction})
    content.append({"type": "text", "text": prompt})
    response = client.messages.create(
        model=PROSE_MODEL,
        max_tokens=PROSE_MAX_TOKENS,
        thinking={"type": "disabled"},
        messages=[{"role": "user", "content": content}],
    )
    # Truncated prose would enter an operat mid-sentence — refuse it like kw
    # refuses an unparsed payload, rather than pass half a sentence downstream.
    if response.stop_reason == "max_tokens":
        raise RuntimeError(f"sekcja {section}: odpowiedź ucięta na max_tokens")
    text = "".join(block.text for block in response.content if block.type == "text")
    if not text.strip():
        raise RuntimeError(f"sekcja {section}: pusta odpowiedź ({response.stop_reason})")
    return ProseCompletion(text, response.usage.input_tokens, response.usage.output_tokens)


class _SectionOutcome(NamedTuple):
    text: str
    violations: list[str]
    input_tokens: int
    output_tokens: int
    # The API call itself failed (as opposed to the guard rejecting the text).
    # Kept apart so the response can tell the two cases apart downstream.
    failed: bool = False


PROSE_RETRY_INSTRUCTION = (
    "UWAGA: poprzednia wersja tej sekcji zawierała liczby spoza DANE: {numbers}. "
    "Napisz ją ponownie, używając wyłącznie liczb z DANE poniżej.\n\n"
    # Trailing blank line on purpose: this block sits directly in front of the
    # validated prompt, and nothing guarantees the API puts a separator between
    # two adjacent text blocks. Without it the model could see
    # "…z DANE poniżej.Jesteś rzeczoznawcą…" — the validated layout mangled on
    # its very first line, which is what putting the correction first was for.
)

PROSE_FAILED_DETAIL = (
    "Nie udało się wygenerować opisów — spróbuj ponownie albo napisz teksty ręcznie."
)


def _prose_section(section: str, facts: dict) -> _SectionOutcome:
    """One section: generate, run the number guard, and on violations give the
    model exactly one more attempt. Still dirty -> the section is reported as
    rejected instead of failing the whole request; the appraiser writes that one
    field by hand ("honest silence") and the valuation stays finishable.

    A failing API call is contained here for the same reason: six sections run
    in parallel, so one rate-limited call must not discard the five that already
    succeeded and were already paid for — and retrying the whole request would
    re-send the same burst of six, the very shape that trips the limit."""
    prompt = prose_core.build_prompt(section, facts)
    input_tokens = output_tokens = 0
    try:
        completion = _generate_prose_section(section, prompt)
        input_tokens += completion.input_tokens
        output_tokens += completion.output_tokens
        text = completion.text.strip()
        violations = prose_core.validate_numbers(text, facts)

        if violations:
            logger.warning("prose section %s: retry after violations %s", section, violations)
            # The validated prompt goes back unchanged — the correction rides
            # along as a separate content block.
            retry = _generate_prose_section(
                section, prompt, PROSE_RETRY_INSTRUCTION.format(numbers=", ".join(violations))
            )
            input_tokens += retry.input_tokens
            output_tokens += retry.output_tokens
            text = retry.text.strip()
            violations = prose_core.validate_numbers(text, facts)
            if violations:
                logger.warning("prose section %s rejected, violations %s", section, violations)
                text = ""
    except Exception as exc:
        # Tokens already spent are still reported: the cost audit must not lose
        # them just because the section did not finish.
        logger.error("prose section %s failed: %s", section, exc)
        return _SectionOutcome("", [], input_tokens, output_tokens, failed=True)
    # Only section names and offending numbers are logged — never the facts
    # (they carry the address) and never the generated text.
    return _SectionOutcome(text, violations, input_tokens, output_tokens)


def _validated_sections(sekcje: list[str]) -> list[str]:
    """Requested sections, deduplicated, order preserved (a section listed twice
    would otherwise cost a second LLM call and collapse in the response dict)."""
    unknown = [s for s in sekcje if s not in prose_core.SECTIONS]
    if unknown:
        raise HTTPException(
            status_code=400, detail=f"Nieznana sekcja operatu: {', '.join(unknown)}."
        )
    sections = list(dict.fromkeys(sekcje))
    if not sections:
        raise HTTPException(status_code=400, detail="Nie wskazano żadnej sekcji do wygenerowania.")
    return sections


def _float_paths(value, path: str = "fakty") -> list[str]:
    """Paths of float leaves in the facts. Numbers must arrive already formatted
    in Polish ("11 111,94") because the number guard compares written forms —
    a raw float would make the model's correct wording look hallucinated.
    `bool` is deliberately not a float, `int` is the documented exception
    (proba.liczba_transakcji)."""
    if isinstance(value, dict):
        return [p for k, v in value.items() for p in _float_paths(v, f"{path}.{k}")]
    if isinstance(value, list):
        return [p for i, v in enumerate(value) for p in _float_paths(v, f"{path}[{i}]")]
    return [path] if isinstance(value, float) else []


def _facts_with_trend(fakty: dict, transakcje: list[ProseTransaction]) -> dict:
    """Facts as the prompt will see them: the sample collapses into a single
    deterministic `proba.trend_cen`. The transactions themselves stay out —
    their prices in the facts would authorise the model to write any of them
    anywhere. No sample or no `proba` in the facts: no trend, no error."""
    proba = fakty.get("proba")
    if not transakcje or not isinstance(proba, dict):
        return fakty
    try:
        trend = prose_core.price_trend([t.model_dump() for t in transakcje])
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="Daty transakcji muszą być w formacie MM-RRRR."
        ) from exc
    return {**fakty, "proba": {**proba, "trend_cen": trend}}


@app.post("/prose-proposal")
def prose_proposal(request: ProseProposalRequest) -> ProseProposalResponse:
    secret = os.environ.get("WORKER_SHARED_SECRET", "")
    if not secret or not kw_core.verify_token(request.token, secret, time.time()):
        raise HTTPException(
            status_code=401,
            detail="Nieprawidłowy lub wygasły token — odśwież stronę i spróbuj ponownie.",
        )
    sections = _validated_sections(request.sekcje)
    floats = _float_paths(request.fakty)
    if floats:
        raise HTTPException(
            status_code=400,
            detail=(
                "Liczby w faktach muszą być tekstem w formacie polskim (np. „71,63”) — "
                f"pola z liczbą zmiennoprzecinkową: {', '.join(floats)}."
            ),
        )
    facts = _facts_with_trend(request.fakty, request.transakcje)

    # Parallel: six sections at ~8 s each would block the wizard for ~50 s.
    # `_prose_section` never raises — a failing section is contained there, so
    # one bad call cannot discard the sections that already succeeded.
    with ThreadPoolExecutor(max_workers=len(sections)) as pool:
        outcomes = list(pool.map(lambda section: _prose_section(section, facts), sections))

    sekcje: dict[str, str] = {}
    odrzucone: dict[str, list[str]] = {}
    input_tokens = output_tokens = 0
    for section, outcome in zip(sections, outcomes):
        input_tokens += outcome.input_tokens  # retries included — the tokens were spent
        output_tokens += outcome.output_tokens
        if outcome.failed:
            odrzucone[section] = []  # empty list = the call failed, no offending numbers
        elif outcome.violations:
            odrzucone[section] = outcome.violations
        else:
            sekcje[section] = outcome.text

    if not sekcje:
        logger.error("prose: no section survived, %s", odrzucone)
        raise HTTPException(status_code=502, detail=PROSE_FAILED_DETAIL)

    return ProseProposalResponse(
        sekcje=sekcje,
        odrzucone=odrzucone,
        model=PROSE_MODEL,
        usage=ProseUsage(input_tokens=input_tokens, output_tokens=output_tokens),
    )


class PhotoProcessResponse(BaseModel):
    """Processed inspection photo (Slice 10, FR-2). F-11: images only, no market values."""

    photo: str  # base64 JPEG — resized to <=1200 px long side, EXIF stripped by re-encode
    width: int
    height: int


@app.post("/photo-process")
def photo_process(
    file: UploadFile = File(...),
    token: str = Form(...),
) -> PhotoProcessResponse:
    secret = os.environ.get("WORKER_SHARED_SECRET", "")
    if not secret or not kw_core.verify_token(token, secret, time.time()):
        raise HTTPException(
            status_code=401,
            detail="Nieprawidłowy lub wygasły token — odśwież stronę i spróbuj ponownie.",
        )
    if file.content_type not in ("image/jpeg", "image/png"):
        raise HTTPException(status_code=415, detail="Obsługiwane są wyłącznie zdjęcia JPEG i PNG.")
    data = file.file.read()
    if len(data) > photo_core.MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Plik jest za duży (limit 10 MB).")
    try:
        jpeg, width, height = photo_core.process_photo(data)
    except Exception as exc:  # unreadable image / decompression bomb — same user answer
        logger.error("photo processing failed: %s", exc)
        raise HTTPException(
            status_code=415,
            detail="Nie udało się odczytać zdjęcia — wgraj plik JPEG lub PNG.",
        ) from exc
    # File bytes are never persisted or logged: `data` dies with this request (RODO).
    return PhotoProcessResponse(
        photo=base64.standard_b64encode(jpeg).decode(), width=width, height=height
    )
