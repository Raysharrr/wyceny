"""Structured JSON logging with a request id bound per request.

Why contextvars and not a module global: uvicorn serves requests concurrently
on one event loop, so a global would let two requests overwrite each other's
id. `structlog.contextvars` scopes the binding to the async task. Starlette's
threadpool (used by the sync `def` handlers here — in this service that is
*every* handler, e.g. /convert-to-pdf) copies the context into the worker
thread, so sync handlers inherit it too.
"""

import time
import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware


def configure_logging() -> None:
    # `cache_logger_on_first_use` stays off (the default): the stdout writer is
    # bound when a logger is built, so caching one would keep writing to the
    # real stdout and make every capsys-based trace test go silently blind.
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
    )


log = structlog.get_logger()


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Binds the web app's traceId, or mints one when called directly."""

    async def dispatch(self, request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:8]
        # Cleared on the way IN, not out: a task reused for the next request
        # must never inherit the previous one's id.
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(trace_id=request_id)
        started = time.monotonic()
        try:
            response = await call_next(request)
        except Exception:
            # An unhandled 500 used to lose BOTH the log line and the header:
            # the exception propagated straight past them, leaving the
            # traceback to stdlib logging without a trace_id. That is the case
            # where correlation matters most, so it must not be the one case
            # without it.
            log.error(
                "request_failed",
                path=request.url.path,
                ms=round((time.monotonic() - started) * 1000),
            )
            raise
        log.info(
            "request_completed",
            path=request.url.path,
            status=response.status_code,
            ms=round((time.monotonic() - started) * 1000),
        )
        # Echoed even when we minted it — the id is read aloud over the phone,
        # so the caller has to be able to see the one we actually used.
        response.headers["x-request-id"] = request_id
        return response
