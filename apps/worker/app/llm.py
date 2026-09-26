"""Port for the LLM calls that read KW documents (user decision 15.09: KW code
never calls the Anthropic SDK directly — only through `LlmClient`).

One method (`parse`: PDFs and/or a text, ADR-021), one adapter, one path to the
API — `messages.stream` (ADR-024). A second adapter and moving the prose call
behind this port are ADR-021 (spec §11), not this file's business. This is the only
`import anthropic` on the KW path; the prose call in main.py keeps its own.
"""

from dataclasses import dataclass
from typing import Protocol

import anthropic
import pydantic
from pydantic import BaseModel

# `stop_reason` for an answer that ended without hitting max_tokens but whose
# text does not validate against the schema — a refusal written as text among
# them. JSON cut at max_tokens is never this: it keeps the API's "max_tokens".
INVALID_OUTPUT = "invalid_output"


@dataclass(frozen=True)
class LlmResult:
    parsed: BaseModel | None
    stop_reason: str | None
    input_tokens: int
    output_tokens: int


class LlmClient(Protocol):
    def parse(
        self,
        *,
        model: str,
        documents: list[str],
        text: str | None,
        prompt: str,
        schema: type[BaseModel],
        max_tokens: int,
        thinking: dict | None = None,
    ) -> LlmResult:
        """Structured answer for a set of base64 PDFs and/or one text, followed by
        the prompt (ADR-021: one prompt reads a printout, a pasted book, or both).
        At least one of `documents`, `text` is required — otherwise `ValueError`,
        a programming error, not a model answer. `parsed is None` means no usable
        answer; `stop_reason` says why. Never raises for an unusable answer."""
        ...


def content_blocks(documents: list[str], text: str | None, prompt: str) -> list[dict]:
    """The user turn: `document` blocks in the given order, the text (when any)
    fenced in `<tresc_ksiegi>` so the model cannot mistake it for instructions,
    the prompt last. With one document and no text this is byte for byte the
    pre-port `parse_pdf` turn (test_llm regression for /kw-extract)."""
    if not documents and text is None:
        raise ValueError("parse needs at least one document or a text")
    blocks: list[dict] = [
        {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_b64},
        }
        for pdf_b64 in documents
    ]
    if text is not None:
        blocks.append({"type": "text", "text": f"<tresc_ksiegi>\n{text}\n</tresc_ksiegi>"})
    blocks.append({"type": "text", "text": prompt})
    return blocks


class AnthropicAdapter:
    def __init__(self, client: anthropic.Anthropic | None = None):
        # Built per call when not injected, as before the port: constructing the
        # client needs ANTHROPIC_API_KEY, which CI does not have.
        self._client = client

    def parse(
        self,
        *,
        model: str,
        documents: list[str],
        text: str | None,
        prompt: str,
        schema: type[BaseModel],
        max_tokens: int,
        thinking: dict | None = None,
    ) -> LlmResult:
        content = content_blocks(documents, text, prompt)  # ValueError before any I/O
        client = self._client or anthropic.Anthropic()  # ANTHROPIC_API_KEY from worker env
        # `thinking` omitted when None: the model's own default applies.
        extra = {} if thinking is None else {"thinking": thinking}
        # Always the stream (ADR-024): the SDK refuses a non-streamed request whose
        # max_tokens implies more than ten minutes (~21k tokens for this model), and
        # one path is simpler than two. `output_config`, never `output_format`:
        # with `output_format` the SDK parses the text inside the stream, and JSON
        # cut at max_tokens would raise there, losing the real stop_reason (#94).
        # The request body is the SDK's own `stream(output_format=…)` body, byte
        # for byte (test_llm, on the wire): it merges `output_format` into this
        # same `output_config`, keys in this order.
        with client.messages.stream(
            model=model,
            max_tokens=max_tokens,
            **extra,
            messages=[{"role": "user", "content": content}],
            output_config={
                "format": {"schema": anthropic.transform_schema(schema), "type": "json_schema"}
            },
        ) as stream:
            response = stream.get_final_message()
        usage = dict(
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )
        if response.stop_reason == "max_tokens":
            # Cut JSON is not parsed at all: the book is too large, not unreadable.
            return LlmResult(parsed=None, stop_reason="max_tokens", **usage)
        try:
            # Every text block, as parse did; the first one is the answer.
            parsed = [
                schema.model_validate_json(block.text)
                for block in response.content
                if block.type == "text"
            ]
        except pydantic.ValidationError:
            # Deliberately not chained or logged: pydantic's message quotes the
            # model's text, which for a KW transcription is the book itself.
            return LlmResult(parsed=None, stop_reason=INVALID_OUTPUT, **usage)
        return LlmResult(
            parsed=parsed[0] if parsed else None, stop_reason=response.stop_reason, **usage
        )
