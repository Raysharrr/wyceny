"""Port `LlmClient` + `AnthropicAdapter` (operat-bugfix KW.1). Offline by contract:
the SDK is either a recording fake or the real `anthropic` client on an httpx
MockTransport — no request ever leaves the process."""

import ast
import base64
import hashlib
import hmac
import time
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


def sdk_answering(body: dict, sent: list[httpx.Request] | None = None) -> anthropic.Anthropic:
    """The real SDK, answering `body` to every request; `sent` collects the requests."""

    def answer(request: httpx.Request) -> httpx.Response:
        if sent is not None:
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
    result = parse_with(sdk_answering(message([{"type": "text", "text": '{"a": "x"}'}])))
    assert result == LlmResult(
        parsed=Schema(a="x"), stop_reason="end_turn", input_tokens=11, output_tokens=7
    )


def test_max_tokens_spent_before_any_text_is_explicit_in_the_result():
    thinking_only = [{"type": "thinking", "thinking": "", "signature": "sig"}]
    result = parse_with(sdk_answering(message(thinking_only, stop_reason="max_tokens")))
    assert result.parsed is None
    assert result.stop_reason == "max_tokens"


def test_refusal_is_explicit_in_the_result():
    result = parse_with(sdk_answering(message([], stop_reason="refusal")))
    assert result.parsed is None
    assert result.stop_reason == "refusal"


def test_refusal_written_as_text_is_invalid_output_not_an_exception():
    """A refusal with a text block fails the schema like any finished answer that
    does not fit it: INVALID_OUTPUT, never "too large" (only max_tokens is)."""
    refusal = message([{"type": "text", "text": "Nie mogę pomóc."}], stop_reason="refusal")
    result = parse_with(sdk_answering(refusal))
    assert result.parsed is None
    assert result.stop_reason == INVALID_OUTPUT


def test_text_cut_mid_json_reports_the_truncation_with_its_usage():
    """Z3 proof 1 (HANDOFF kw-banner-fix). `messages.parse` validated the text
    INSIDE the SDK, so JSON cut at max_tokens raised pydantic's ValidationError
    there and the adapter could only say INVALID_OUTPUT — the book was too large,
    the appraiser was told it was unreadable. The API's own stop_reason and usage
    must reach the caller; no exception, no partial content."""
    cut = message([{"type": "text", "text": '{"a": "tresc ksieg'}], stop_reason="max_tokens")
    result = parse_with(sdk_answering(cut))
    assert result == LlmResult(
        parsed=None, stop_reason="max_tokens", input_tokens=11, output_tokens=7
    )


def test_a_finished_answer_against_the_schema_is_invalid_output():
    """Z3 proof 2, negative control: green before and after the fix. Tokens are
    not asserted — before the fix the SDK's exception left none to report."""
    wrong = message([{"type": "text", "text": '{"b": "x"}'}])
    result = parse_with(sdk_answering(wrong))
    assert result.parsed is None
    assert result.stop_reason == INVALID_OUTPUT


# --- regression: /kw-extract through the port is the pre-port call, 1:1 ------------


class RecordingSdk:
    """Stands in for `anthropic.Anthropic()`: records the kwargs of `messages.create`
    and answers `payload` as the model's JSON text."""

    def __init__(self, payload: BaseModel):
        self.messages = self
        self.kwargs: dict | None = None
        self._response = SimpleNamespace(
            content=[SimpleNamespace(type="text", text=payload.model_dump_json())],
            stop_reason="end_turn",
            usage=SimpleNamespace(input_tokens=1, output_tokens=1),
        )

    def create(self, **kwargs):
        self.kwargs = kwargs
        return self._response


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
    """The adapter calls `messages.create`, not `messages.parse` (Z3 kw-banner-fix:
    parse lost the stop_reason of cut JSON), so the pre-port call is compared where
    it matters — on the wire: the HTTP body /kw-extract sends is byte for byte the
    body of the `messages.parse` call main.py made before the port."""
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    pdf = b"%PDF-1.4 regresja"
    answer = message([{"type": "text", "text": payload().model_dump_json()}])

    # Reference answer: the endpoint with the model call stubbed at the old seam.
    monkeypatch.setattr(main, "_extract_kw_payload", lambda pdf_b64: payload())
    before = post_kw_extract(pdf)
    monkeypatch.undo()

    # Reference request: verbatim the pre-port `messages.parse` call.
    pre_port: list[httpx.Request] = []
    sdk_answering(answer, pre_port).messages.parse(
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

    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    sent: list[httpx.Request] = []
    monkeypatch.setattr(main, "kw_llm", lambda: AnthropicAdapter(sdk_answering(answer, sent)))
    after = post_kw_extract(pdf)

    (reference,) = pre_port
    (request,) = sent
    assert (request.method, request.url) == (reference.method, reference.url)
    assert request.content == reference.content
    assert after.status_code == before.status_code == 200
    assert after.json() == before.json()


def test_kw_extract_without_parsed_output_is_the_same_502(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    cut = message([{"type": "text", "text": '{"docType": "akt", "kwLok'}], stop_reason="max_tokens")
    monkeypatch.setattr(main, "kw_llm", lambda: AnthropicAdapter(sdk_answering(cut)))
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


def test_parse_pdf_is_gone_from_the_port_and_the_adapter():
    assert not hasattr(LlmClient, "parse_pdf")
    assert not hasattr(AnthropicAdapter, "parse_pdf")
