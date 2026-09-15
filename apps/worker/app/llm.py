"""Port for the LLM calls that read KW documents (user decision 15.09: KW code
never calls the Anthropic SDK directly — only through `LlmClient`).

One method, one adapter. A second adapter and moving the prose call behind this
port are ADR-021 (spec §11), not this file's business. This is the only
`import anthropic` on the KW path; the prose call in main.py keeps its own.
"""

from dataclasses import dataclass
from typing import Protocol

import anthropic
import pydantic
from pydantic import BaseModel

# `stop_reason` for text the SDK could not validate against the schema. The SDK
# validates INSIDE `messages.parse`, so JSON cut at max_tokens raises there and
# the response (with its real stop_reason and usage) is lost to the caller.
INVALID_OUTPUT = "invalid_output"


@dataclass(frozen=True)
class LlmResult:
    parsed: BaseModel | None
    stop_reason: str | None
    input_tokens: int
    output_tokens: int


class LlmClient(Protocol):
    def parse_pdf(
        self,
        *,
        model: str,
        pdf_b64: str,
        prompt: str,
        schema: type[BaseModel],
        max_tokens: int,
        thinking: dict | None = None,
    ) -> LlmResult:
        """Structured answer for one PDF + prompt. `parsed is None` means no usable
        answer; `stop_reason` says why. Never raises for an unusable answer."""
        ...


class AnthropicAdapter:
    def __init__(self, client: anthropic.Anthropic | None = None):
        # Built per call when not injected, as before the port: constructing the
        # client needs ANTHROPIC_API_KEY, which CI does not have.
        self._client = client

    def parse_pdf(
        self,
        *,
        model: str,
        pdf_b64: str,
        prompt: str,
        schema: type[BaseModel],
        max_tokens: int,
        thinking: dict | None = None,
    ) -> LlmResult:
        client = self._client or anthropic.Anthropic()  # ANTHROPIC_API_KEY from worker env
        # `thinking` omitted when None: the model's own default applies.
        extra = {} if thinking is None else {"thinking": thinking}
        try:
            response = client.messages.parse(
                model=model,
                max_tokens=max_tokens,
                **extra,
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
                            {"type": "text", "text": prompt},
                        ],
                    }
                ],
                output_format=schema,
            )
        except pydantic.ValidationError:
            # Deliberately not chained or logged: pydantic's message quotes the
            # model's text, which for a KW transcription is the book itself.
            return LlmResult(
                parsed=None, stop_reason=INVALID_OUTPUT, input_tokens=0, output_tokens=0
            )
        return LlmResult(
            parsed=response.parsed_output,
            stop_reason=response.stop_reason,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )
