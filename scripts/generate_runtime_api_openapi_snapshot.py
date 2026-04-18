from __future__ import annotations

import json
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = ROOT / "docs" / "runtime_api_openapi_snapshot.json"
RUNTIME_PATHS = (
    "/api/bootstrap",
    "/api/runtime/status",
    "/api/discovery/search",
    "/api/assets/availability",
    "/api/assets/{asset_fqn}",
    "/api/assets/{asset_fqn}/columns/{column_name}/description",
    "/api/assets/{asset_fqn}/columns/{column_name}/tags",
    "/api/assets/{asset_fqn}/columns/{column_name}/metadata",
    "/api/assets/{asset_fqn}/description",
    "/api/assets/{asset_fqn}/metadata",
    "/api/assets/{asset_fqn}/owners",
    "/api/assets/{asset_fqn}/tags",
    "/api/lineage/{asset_fqn}",
    "/api/governance/summary",
    "/api/governance/glossary",
    "/api/governance/glossary/{term_id}",
    "/api/governance/requests",
    "/api/governance/requests/{request_id}",
    "/api/governance/notifications/{notification_id}",
    "/api/governance/owners",
    "/api/governance/audit-timeline/{asset_fqn}",
    "/api/export/assets",
    "/api/export/{job_id}/download",
    "/api/admin/export-jobs",
)

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _ensure_runtime_import_support() -> None:
    try:
        import fastapi  # noqa: F401
        import pydantic  # noqa: F401
    except ModuleNotFoundError as exc:
        if exc.name not in {
            "fastapi",
            "fastapi.responses",
            "fastapi.staticfiles",
            "pydantic",
        }:
            raise
    else:
        return

    fastapi = ModuleType("fastapi")

    class _Route:
        def __init__(self, path: str, method: str, endpoint: Callable[..., Any]):
            self.path = path
            self.methods = {method.upper()}
            self.endpoint = endpoint

    class _APIRouter:
        def __init__(self, *, prefix: str = "", tags: list[str] | None = None):
            self.prefix = prefix
            self.tags = tags or []
            self.routes: list[_Route] = []

        def _register(self, method: str, path: str, endpoint: Callable[..., Any]) -> _Route:
            route = _Route(f"{self.prefix}{path}", method, endpoint)
            self.routes.append(route)
            return route

        def _decorator(self, method: str, path: str):
            def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
                self._register(method, path, func)
                return func

            return decorator

        def get(self, path: str, *args, **kwargs):
            return self._decorator("get", path)

        def post(self, path: str, *args, **kwargs):
            return self._decorator("post", path)

        def put(self, path: str, *args, **kwargs):
            return self._decorator("put", path)

        def patch(self, path: str, *args, **kwargs):
            return self._decorator("patch", path)

        def delete(self, path: str, *args, **kwargs):
            return self._decorator("delete", path)

    class _FastAPI(_APIRouter):
        def __init__(self, *args, title: str = "FastAPI", **kwargs):
            super().__init__(prefix="", tags=None)
            self.title = title
            self.args = args
            self.kwargs = kwargs

        def middleware(self, _name: str):
            def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
                return func

            return decorator

        def exception_handler(self, *args, **kwargs):
            def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
                return func

            return decorator

        def include_router(self, router: _APIRouter) -> None:
            self.routes.extend(router.routes)

        def mount(self, *args, **kwargs) -> None:
            return None

        def openapi(self) -> dict[str, Any]:
            paths: dict[str, Any] = {}
            for route in self.routes:
                path_entry = paths.setdefault(route.path, {})
                for method in route.methods:
                    operation_key = method.lower()
                    path_entry[operation_key] = {
                        "operationId": f"{operation_key}_{route.path.strip('/').replace('/', '_') or 'root'}",
                        "responses": {"200": {"description": "Successful Response"}},
                    }
            return {
                "openapi": "3.1.0",
                "info": {"title": self.title, "version": "0.1.0"},
                "paths": paths,
            }

        def __getattr__(self, name: str):
            if name in {"get", "post", "put", "patch", "delete", "options", "head"}:
                return getattr(super(), name if name in {"get", "post", "put", "patch", "delete"} else "get")
            raise AttributeError(name)

    class _HTTPException(Exception):
        def __init__(self, status_code: int = 500, detail: str = ""):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    def _query(*args, **kwargs):
        if args:
            return args[0]
        return kwargs.get("default")

    class _Request:
        def __init__(self):
            self.headers: dict[str, str] = {}
            self.state = SimpleNamespace()

    fastapi.APIRouter = _APIRouter
    fastapi.FastAPI = _FastAPI
    fastapi.HTTPException = _HTTPException
    fastapi.Query = _query
    fastapi.Request = _Request

    responses = ModuleType("fastapi.responses")

    class _HTMLResponse:
        def __init__(self, content: Any = "", status_code: int = 200):
            self.content = content
            self.status_code = status_code
            self.headers: dict[str, str] = {}

    class _JSONResponse(_HTMLResponse):
        pass

    responses.HTMLResponse = _HTMLResponse
    responses.JSONResponse = _JSONResponse

    staticfiles = ModuleType("fastapi.staticfiles")

    class _StaticFiles:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

    staticfiles.StaticFiles = _StaticFiles

    sys.modules["fastapi"] = fastapi
    sys.modules["fastapi.responses"] = responses
    sys.modules["fastapi.staticfiles"] = staticfiles

    pydantic = ModuleType("pydantic")

    class _BaseModel:
        def __init__(self, *args, **kwargs):
            for key, value in kwargs.items():
                setattr(self, key, value)

    def _field(default=None, **kwargs):
        if "default_factory" in kwargs and callable(kwargs["default_factory"]):
            return kwargs["default_factory"]()
        return default

    def _field_validator(*args, **kwargs):
        def decorator(func):
            return func

        return decorator

    pydantic.BaseModel = _BaseModel
    pydantic.Field = _field
    pydantic.field_validator = _field_validator

    sys.modules["pydantic"] = pydantic


def _load_runtime_app():
    try:
        import runtime_app as module

        return module
    except ModuleNotFoundError as exc:
        if exc.name not in {
            "fastapi",
            "fastapi.responses",
            "fastapi.staticfiles",
            "pydantic",
        }:
            raise
    sys.modules.pop("runtime_app", None)
    _ensure_runtime_import_support()
    import runtime_app as module

    return module


runtime_app = _load_runtime_app()


def build_runtime_api_snapshot() -> dict[str, Any]:
    openapi = runtime_app.app.openapi()
    snapshot = {
        "openapi": openapi.get("openapi", ""),
        "info": openapi.get("info", {}),
        "paths": {
            path: openapi.get("paths", {}).get(path, {})
            for path in RUNTIME_PATHS
        },
    }
    components = openapi.get("components", {})
    if components:
        snapshot["components"] = components
    return snapshot


def write_runtime_api_snapshot(path: Path = SNAPSHOT_PATH) -> Path:
    snapshot = build_runtime_api_snapshot()
    path.write_text(f"{json.dumps(snapshot, indent=2, sort_keys=True)}\n", encoding="utf-8")
    return path


if __name__ == "__main__":
    written = write_runtime_api_snapshot()
    print(written)
