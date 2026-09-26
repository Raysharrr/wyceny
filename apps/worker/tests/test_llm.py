"""Port `LlmClient` + `AnthropicAdapter` (operat-bugfix KW.1). Offline by contract:
the SDK is either a recording fake or the real `anthropic` client on an httpx
MockTransport — no request ever leaves the process."""

import ast
import base64
import hashlib
import hmac
import json
import time
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app import main
from app.kw import EXTRACTION_PROMPT, KwExtractPayload
from app.llm import INVALID_OUTPUT, AnthropicAdapter, LlmClient, LlmResult

SECRET = "test-secret"
APP = Path(__file__).resolve().parents[1] / "app"
client = TestClient(main.app)


class Schema(BaseModel):
    a: str


def sse(body: dict) -> bytes:
    """`message(...)` as the API's event stream. A text block arrives as one
    `text_delta`; any other block (thinking, in these tests) whole in its
    `content_block_start` — the SDK takes the start block as the snapshot."""
    out: list[str] = []

    def event(name: str, data: dict) -> None:
        out.append(f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n")

    start = {
        **body,
        "content": [],
        "stop_reason": None,
        "usage": {"input_tokens": body["usage"]["input_tokens"], "output_tokens": 0},
    }
    event("message_start", {"type": "message_start", "message": start})
    for i, block in enumerate(body["content"]):
        text = block["type"] == "text"
        opening = {"type": "text", "text": ""} if text else block
        event(
            "content_block_start",
            {"type": "content_block_start", "index": i, "content_block": opening},
        )
        if text:
            event(
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": i,
                    "delta": {"type": "text_delta", "text": block["text"]},
                },
            )
        event("content_block_stop", {"type": "content_block_stop", "index": i})
    event(
        "message_delta",
        {
            "type": "message_delta",
            "delta": {"stop_reason": body["stop_reason"], "stop_sequence": None},
            "usage": {"output_tokens": body["usage"]["output_tokens"]},
        },
    )
    event("message_stop", {"type": "message_stop"})
    return "".join(out).encode()


def sdk_streaming(body: dict, sent: list[httpx.Request] | None = None) -> anthropic.Anthropic:
    """The real SDK, streaming `body` to every request; `sent` collects the requests."""

    def answer(request: httpx.Request) -> httpx.Response:
        if sent is not None:
            sent.append(request)
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=sse(body))

    transport = httpx.MockTransport(answer)
    return anthropic.Anthropic(
        api_key="test-key", http_client=httpx.Client(transport=transport), max_retries=0
    )


def sdk_answering_json(body: dict, sent: list[httpx.Request]) -> anthropic.Anthropic:
    """The real SDK answering `body` as plain JSON — only to build the pre-port
    `messages.parse` request the stream is compared with; the adapter never gets it."""

    def answer(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json=body)

    transport = httpx.MockTransport(answer)
    return anthropic.Anthropic(
        api_key="test-key", http_client=httpx.Client(transport=transport), max_retries=0
    )


def message(content: list[dict], stop_reason: str = "end_turn") -> dict:
    return {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-5",
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 11, "output_tokens": 7},
    }


def parse_with(sdk) -> LlmResult:
    return AnthropicAdapter(sdk).parse(
        model="claude-sonnet-5",
        documents=["JVBERg=="],
        text=None,
        prompt="p",
        schema=Schema,
        max_tokens=100,
    )


def anthropic_imports(path: Path) -> list[str]:
    """Names of the functions holding an `import anthropic` (`<module>` = top level)."""
    tree = ast.parse(path.read_text())
    found: list[str] = []

    def visit(node: ast.AST, owner: str) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                visit(child, child.name)
                continue
            if isinstance(child, ast.Import) and any(
                a.name.split(".")[0] == "anthropic" for a in child.names
            ):
                found.append(owner)
            if (
                isinstance(child, ast.ImportFrom)
                and (child.module or "").split(".")[0] == "anthropic"
            ):
                found.append(owner)
            visit(child, owner)

    visit(tree, "<module>")
    return found


def test_on_the_kw_path_only_the_adapter_imports_anthropic():
    assert anthropic_imports(APP / "llm.py") == ["<module>"]
    assert anthropic_imports(APP / "kw.py") == []
    assert anthropic_imports(APP / "kw_validate.py") == []
    # The prose call stays as it was (ADR-021 moves it behind the port, not this block).
    # PR-1 Głuszyna adds a SECOND, read-only touchpoint: `_prose_failure_kind`
    # imports the SDK for its exception classes to tell a refused key from a
    # dropped connection, and calls nothing. The list stays closed — anything
    # else in main.py reaching for the SDK is still a failure.
    assert anthropic_imports(APP / "main.py") == [
        "_generate_prose_section",
        "_prose_failure_kind",
    ]


def test_success_carries_parsed_output_and_usage():
    result = parse_with(sdk_streaming(message([{"type": "text", "text": '{"a": "x"}'}])))
    assert result == LlmResult(
        parsed=Schema(a="x"), stop_reason="end_turn", input_tokens=11, output_tokens=7
    )


def test_max_tokens_spent_before_any_text_is_explicit_in_the_result():
    thinking_only = [{"type": "thinking", "thinking": "", "signature": "sig"}]
    result = parse_with(sdk_streaming(message(thinking_only, stop_reason="max_tokens")))
    assert result.parsed is None
    assert result.stop_reason == "max_tokens"


def test_refusal_is_explicit_in_the_result():
    result = parse_with(sdk_streaming(message([], stop_reason="refusal")))
    assert result.parsed is None
    assert result.stop_reason == "refusal"


def test_refusal_written_as_text_is_invalid_output_not_an_exception():
    """A refusal with a text block fails the schema like any finished answer that
    does not fit it: INVALID_OUTPUT, never "too large" (only max_tokens is)."""
    refusal = message([{"type": "text", "text": "Nie mogę pomóc."}], stop_reason="refusal")
    result = parse_with(sdk_streaming(refusal))
    assert result.parsed is None
    assert result.stop_reason == INVALID_OUTPUT


def test_json_cut_at_max_tokens_over_the_stream_is_max_tokens_with_usage():
    """Z3 proof 1 (HANDOFF kw-banner-fix), over the stream since ADR-024.
    `messages.parse` validated the text INSIDE the SDK, so JSON cut at max_tokens
    raised pydantic's ValidationError there and the adapter could only say
    INVALID_OUTPUT — the book was too large, the appraiser was told it was
    unreadable. `messages.stream(output_format=…)` would do the same inside the
    stream. The API's own stop_reason and usage must reach the caller; no
    exception, no partial content."""
    cut = message([{"type": "text", "text": '{"a": "tresc ksieg'}], stop_reason="max_tokens")
    result = parse_with(sdk_streaming(cut))
    assert result == LlmResult(
        parsed=None, stop_reason="max_tokens", input_tokens=11, output_tokens=7
    )


def test_a_finished_answer_against_the_schema_is_invalid_output():
    """Z3 proof 2, negative control: green before and after the fix. Tokens are
    not asserted — before the fix the SDK's exception left none to report."""
    wrong = message([{"type": "text", "text": '{"b": "x"}'}])
    result = parse_with(sdk_streaming(wrong))
    assert result.parsed is None
    assert result.stop_reason == INVALID_OUTPUT


# --- regression: /kw-extract through the port is the pre-port call, 1:1 ------------


class RecordingSdk:
    """Stands in for `anthropic.Anthropic()`: records the kwargs of `messages.stream`
    and answers `payload` as the model's JSON text."""

    def __init__(self, payload: BaseModel):
        self.messages = self
        self.kwargs: dict | None = None
        self._response = SimpleNamespace(
            content=[SimpleNamespace(type="text", text=payload.model_dump_json())],
            stop_reason="end_turn",
            usage=SimpleNamespace(input_tokens=1, output_tokens=1),
        )

    @contextmanager
    def stream(self, **kwargs):
        self.kwargs = kwargs
        yield SimpleNamespace(get_final_message=lambda: self._response)


def mint() -> str:
    exp = int(time.time()) + 300
    sig = hmac.new(SECRET.encode(), f"{exp}.n0nce".encode(), hashlib.sha256).hexdigest()
    return f"{exp}.n0nce.{sig}"


def payload() -> KwExtractPayload:
    return KwExtractPayload(
        docType="akt",
        kwLokalu=None,
        kwGruntu=None,
        kwInne=[],
        powUzytkowaKw=69.56,
        udzial="1234/56789",
        sad="Sąd Rejonowy",
        wydzial="VI Wydział Ksiąg Wieczystych",
        dataDokumentu="2026-05-11",
        dzial3=None,
        dzial4=None,
    )


def post_kw_extract(pdf: bytes):
    return client.post(
        "/kw-extract",
        data={"token": mint(), "expected_type": "akt"},
        files={"file": ("akt.pdf", pdf, "application/pdf")},
    )


def test_kw_extract_sends_the_pre_port_request_and_answers_unchanged(monkeypatch):
    """The adapter always streams (ADR-024) with `output_config`, never
    `output_format` (Z3 kw-banner-fix: parsing inside the SDK lost the stop_reason
    of cut JSON), so the call is compared where it matters — on the wire. The HTTP
    body /kw-extract sends is byte for byte the body of the SDK's own
    `messages.stream(output_format=KwExtractPayload)`, and that is the body of the
    `messages.parse` call main.py made before the port plus `"stream": true` —
    nothing else changed for /kw-extract."""
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    pdf = b"%PDF-1.4 regresja"
    answer = message([{"type": "text", "text": payload().model_dump_json()}])

    # Reference answer: the endpoint with the model call stubbed at the old seam.
    monkeypatch.setattr(main, "_extract_kw_payload", lambda pdf_b64: payload())
    before = post_kw_extract(pdf)
    monkeypatch.undo()

    call = dict(
        model="claude-sonnet-5",
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
                            "data": base64.standard_b64encode(pdf).decode(),
                        },
                    },
                    {"type": "text", "text": EXTRACTION_PROMPT},
                ],
            }
        ],
        output_format=KwExtractPayload,
    )
    # Reference request: the SDK's stream helper with `output_format`.
    reference_sent: list[httpx.Request] = []
    with sdk_streaming(answer, reference_sent).messages.stream(**call) as reference_stream:
        reference_stream.get_final_message()
    # The pre-port request: verbatim the `messages.parse` call main.py made.
    pre_port: list[httpx.Request] = []
    sdk_answering_json(answer, pre_port).messages.parse(**call)

    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    sent: list[httpx.Request] = []
    monkeypatch.setattr(main, "kw_llm", lambda: AnthropicAdapter(sdk_streaming(answer, sent)))
    after = post_kw_extract(pdf)

    (reference,) = reference_sent
    (request,) = sent
    assert (request.method, request.url) == (reference.method, reference.url)
    assert request.content == reference.content
    (parsed_call,) = pre_port
    assert request.content == parsed_call.content[:-1] + b',"stream":true}'
    assert after.status_code == before.status_code == 200
    assert after.json() == before.json()


def test_kw_extract_without_parsed_output_is_the_same_502(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    cut = message([{"type": "text", "text": '{"docType": "akt", "kwLok'}], stop_reason="max_tokens")
    monkeypatch.setattr(main, "kw_llm", lambda: AnthropicAdapter(sdk_streaming(cut)))
    resp = post_kw_extract(b"%PDF-1.4 x")
    assert resp.status_code == 502
    assert resp.json()["detail"] == (
        "Nie udało się odczytać dokumentu — spróbuj ponownie albo wpisz dane ręcznie."
    )


# --- one port method for PDFs and/or a pasted book (ADR-021, R3) ------------------


def document_block(pdf_b64: str) -> dict:
    return {
        "type": "document",
        "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_b64},
    }


def content_sent(sdk: RecordingSdk) -> list[dict]:
    assert sdk.kwargs is not None
    (turn,) = sdk.kwargs["messages"]
    assert turn["role"] == "user"
    return turn["content"]


def test_two_documents_become_two_document_blocks_in_order_then_the_prompt():
    sdk = RecordingSdk(Schema(a="x"))
    result = AnthropicAdapter(sdk).parse(
        model="claude-sonnet-5",
        documents=["JVBERg==", "JVBERi0x"],
        text=None,
        prompt="p",
        schema=Schema,
        max_tokens=100,
    )
    assert result.parsed == Schema(a="x")
    assert content_sent(sdk) == [
        document_block("JVBERg=="),
        document_block("JVBERi0x"),
        {"type": "text", "text": "p"},
    ]
    assert sdk.kwargs["output_config"] == {
        "format": {"schema": anthropic.transform_schema(Schema), "type": "json_schema"}
    }
    assert sdk.kwargs["max_tokens"] == 100
    assert "thinking" not in sdk.kwargs


def test_text_alone_is_one_block_fenced_in_tresc_ksiegi_then_the_prompt():
    sdk = RecordingSdk(Schema(a="x"))
    AnthropicAdapter(sdk).parse(
        model="claude-sonnet-5",
        documents=[],
        text="DZIAŁ I-O\nNumer działki | 1/2 | 1",
        prompt="p",
        schema=Schema,
        max_tokens=100,
    )
    assert content_sent(sdk) == [
        {
            "type": "text",
            "text": "<tresc_ksiegi>\nDZIAŁ I-O\nNumer działki | 1/2 | 1\n</tresc_ksiegi>",
        },
        {"type": "text", "text": "p"},
    ]


def test_documents_and_text_together_are_documents_then_text_then_prompt():
    sdk = RecordingSdk(Schema(a="x"))
    AnthropicAdapter(sdk).parse(
        model="claude-sonnet-5",
        documents=["JVBERg=="],
        text="DZIAŁ IV\nBRAK WPISÓW",
        prompt="p",
        schema=Schema,
        max_tokens=100,
        thinking={"type": "adaptive"},
    )
    assert content_sent(sdk) == [
        document_block("JVBERg=="),
        {"type": "text", "text": "<tresc_ksiegi>\nDZIAŁ IV\nBRAK WPISÓW\n</tresc_ksiegi>"},
        {"type": "text", "text": "p"},
    ]
    assert sdk.kwargs["thinking"] == {"type": "adaptive"}


def test_nothing_to_read_is_a_programming_error_and_never_a_request():
    sdk = RecordingSdk(Schema(a="x"))
    with pytest.raises(ValueError):
        AnthropicAdapter(sdk).parse(
            model="claude-sonnet-5",
            documents=[],
            text=None,
            prompt="p",
            schema=Schema,
            max_tokens=100,
        )
    assert sdk.kwargs is None


def test_adapter_has_one_path_the_stream():
    """F-W1 (ADR-024): one path for /kw-extract and /kw-transcribe — the stream.
    `create` refuses max_tokens above ~21k without it; `parse` validates cut JSON
    inside the SDK."""
    tree = ast.parse((APP / "llm.py").read_text())
    calls = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }
    assert "stream" in calls
    assert not calls & {"create", "parse"}


def test_parse_pdf_is_gone_from_the_port_and_the_adapter():
    assert not hasattr(LlmClient, "parse_pdf")
    assert not hasattr(AnthropicAdapter, "parse_pdf")
