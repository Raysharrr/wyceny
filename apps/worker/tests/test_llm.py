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
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app import main
from app.kw import EXTRACTION_PROMPT, KwExtractPayload
from app.llm import INVALID_OUTPUT, AnthropicAdapter, LlmResult

SECRET = "test-secret"
APP = Path(__file__).resolve().parents[1] / "app"
client = TestClient(main.app)


class Schema(BaseModel):
    a: str


def sdk_answering(body: dict) -> anthropic.Anthropic:
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=body))
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
    return AnthropicAdapter(sdk).parse_pdf(
        model="claude-sonnet-5", pdf_b64="JVBERg==", prompt="p", schema=Schema, max_tokens=100
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
    assert anthropic_imports(APP / "main.py") == ["_generate_prose_section"]


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
    """With a text block the SDK validates the refusal against the schema, raises,
    and the real stop_reason is lost — the adapter can only report INVALID_OUTPUT."""
    refusal = message([{"type": "text", "text": "Nie mogę pomóc."}], stop_reason="refusal")
    result = parse_with(sdk_answering(refusal))
    assert result.parsed is None
    assert result.stop_reason == INVALID_OUTPUT


def test_text_cut_mid_json_comes_back_as_no_parsed_output_not_an_exception():
    """`messages.parse` validates the text INSIDE the SDK, so JSON cut at max_tokens
    raises pydantic's ValidationError there — and its message quotes the input.
    The adapter must turn that into an explicit result, never let it propagate."""
    cut = message([{"type": "text", "text": '{"a": "tresc ksieg'}], stop_reason="max_tokens")
    result = parse_with(sdk_answering(cut))
    assert result == LlmResult(
        parsed=None, stop_reason=INVALID_OUTPUT, input_tokens=0, output_tokens=0
    )


# --- regression: /kw-extract through the port is the pre-port call, 1:1 ------------


class RecordingSdk:
    """Stands in for `anthropic.Anthropic()`: records the kwargs of `messages.parse`."""

    def __init__(self, payload: KwExtractPayload):
        self.messages = self
        self.kwargs: dict | None = None
        self._response = SimpleNamespace(
            parsed_output=payload,
            stop_reason="end_turn",
            usage=SimpleNamespace(input_tokens=1, output_tokens=1),
        )

    def parse(self, **kwargs):
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


def test_kw_extract_sends_the_pre_port_sdk_call_and_answers_unchanged(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    pdf = b"%PDF-1.4 regresja"

    # Reference answer: the endpoint with the model call stubbed at the old seam.
    monkeypatch.setattr(main, "_extract_kw_payload", lambda pdf_b64: payload())
    before = post_kw_extract(pdf)
    monkeypatch.undo()

    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    sdk = RecordingSdk(payload())
    monkeypatch.setattr(main, "kw_llm", lambda: AnthropicAdapter(sdk))
    after = post_kw_extract(pdf)

    # Verbatim the kwargs of the `messages.parse` call main.py made before the port.
    assert sdk.kwargs == dict(
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
