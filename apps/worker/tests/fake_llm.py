"""Test double for the `LlmClient` port (app/llm.py): returns a preset result and
remembers every call, so a test can assert both what the KW code asked for and
how it handled the answer — without the SDK and without the network."""

from app.llm import LlmResult


class FakeLlmClient:
    def __init__(self, result: LlmResult):
        self.result = result
        self.calls: list[dict] = []

    def parse(self, **kwargs) -> LlmResult:
        self.calls.append(kwargs)
        return self.result
