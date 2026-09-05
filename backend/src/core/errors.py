"""Structured error envelope for API responses.

All non-2xx responses go out as:
    {"error": {"code": "...", "message": "...", "details": {...} | null}}

Rationale: `HTTPException(detail="Not found")` on the wire is just a raw
string in `detail`, which forces the FE to sniff strings for actionable
information. A stable `code` slug + `details` payload lets the FE map
errors to real UX (a specific toast, a modal, a retry, a redirect).
"""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.core.logging import get_logger

logger = get_logger(__name__)


# Standard code slugs. Add more per-domain codes as needed by raising
# `ApiError(code=..., ...)` from routes.
_STATUS_TO_CODE = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    410: "gone",
    413: "payload_too_large",
    422: "unprocessable_entity",
    429: "rate_limited",
    500: "internal_error",
    502: "upstream_error",
    503: "service_unavailable",
    504: "upstream_timeout",
}


class ApiError(HTTPException):
    """HTTPException with a stable machine-readable code + optional details.
    Prefer this in new code over `HTTPException(detail="...")`."""

    def __init__(
        self,
        status_code: int,
        message: str,
        *,
        code: str | None = None,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ):
        super().__init__(status_code=status_code, detail=message, headers=headers)
        self.code = code or _STATUS_TO_CODE.get(status_code, "error")
        self.message = message
        self.details = details


def _envelope(code: str, message: str, details: Any | None = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error_handler(_req: Request, exc: ApiError):
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(exc.code, exc.message, exc.details),
            headers=exc.headers,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_exc_handler(_req: Request, exc: StarletteHTTPException):
        # Preserve detail-string content, but wrap in the envelope so all
        # non-2xx bodies share one shape. Existing routes need no change.
        code = _STATUS_TO_CODE.get(exc.status_code, "error")
        message = exc.detail if isinstance(exc.detail, str) else "Request failed"
        details = None if isinstance(exc.detail, str) else exc.detail
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(code, message, details),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(_req: Request, exc: RequestValidationError):
        # Keep the field-level breakdown under `details` so a form can
        # highlight the exact input that failed.
        return JSONResponse(
            status_code=422,
            content=_envelope(
                "validation_error",
                "Invalid request payload",
                {"issues": exc.errors()},
            ),
        )

    @app.exception_handler(Exception)
    async def _fallback_handler(_req: Request, exc: Exception):
        logger.exception(f"unhandled error: {exc}")
        return JSONResponse(
            status_code=500,
            content=_envelope("internal_error", "Internal server error"),
        )
