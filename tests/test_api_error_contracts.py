from __future__ import annotations

import asyncio
import json
import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError

import runtime_app
from atlas.api import response as response_api


def _request(request_id: str = "req-123") -> SimpleNamespace:
    return SimpleNamespace(
        headers={"X-GOVAT-Client-Request-ID": request_id},
        state=SimpleNamespace(http_request_id=request_id),
        url=SimpleNamespace(path="/api/test"),
    )


def _json(response) -> dict:
    return json.loads(response.body.decode("utf-8"))


class ApiErrorContractTests(unittest.TestCase):
    def test_error_response_includes_request_id_in_body_meta_and_header(self) -> None:
        response = response_api._error_response(
            _request("error-response-id"),
            status_code=404,
            source="test-source",
            detail="Missing.",
        )
        payload = _json(response)

        self.assertEqual(response.headers["x-request-id"], "error-response-id")
        self.assertEqual(payload["requestId"], "error-response-id")
        self.assertEqual(payload["httpRequestId"], "error-response-id")
        self.assertEqual(payload["meta"]["requestId"], "error-response-id")
        self.assertEqual(payload["meta"]["httpRequestId"], "error-response-id")

    def test_http_exception_handler_includes_request_id(self) -> None:
        response = asyncio.run(
            runtime_app.http_exception_handler(
                _request("http-exception-id"),
                HTTPException(status_code=403, detail="Forbidden."),
            )
        )
        payload = _json(response)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.headers["x-request-id"], "http-exception-id")
        self.assertEqual(payload["requestId"], "http-exception-id")
        self.assertEqual(payload["httpRequestId"], "http-exception-id")

    def test_validation_exception_handler_includes_request_id(self) -> None:
        exc = RequestValidationError(
            [{"loc": ("body", "name"), "msg": "Field required", "type": "missing"}]
        )
        response = asyncio.run(
            runtime_app.request_validation_exception_handler(
                _request("validation-id"),
                exc,
            )
        )
        payload = _json(response)

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.headers["x-request-id"], "validation-id")
        self.assertEqual(payload["requestId"], "validation-id")
        self.assertEqual(payload["errors"][0]["loc"], ["body", "name"])

    def test_unhandled_exception_handler_includes_request_id(self) -> None:
        response = asyncio.run(
            runtime_app.unhandled_exception_handler(
                _request("unhandled-id"),
                RuntimeError("boom"),
            )
        )
        payload = _json(response)

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.headers["x-request-id"], "unhandled-id")
        self.assertEqual(payload["requestId"], "unhandled-id")
        self.assertEqual(payload["errorClass"], "RuntimeError")


if __name__ == "__main__":
    unittest.main()
