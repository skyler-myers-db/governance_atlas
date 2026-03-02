"""OpenMetadata REST API client — optional connector for Governance Hub.

OpenMetadata is 100% open source (Apache 2.0) and simpler to self-host than
DataHub (single Java service + database). Its REST API is straightforward.

API Reference: https://docs.open-metadata.org/swagger
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import requests


class OpenMetadataError(RuntimeError):
    pass


@dataclass(frozen=True)
class OMSearchResult:
    fqn: str
    entity_type: str
    name: str
    description: str | None = None
    service: str | None = None


class OpenMetadataClient:
    """Thin REST client for a self-hosted OpenMetadata instance."""

    def __init__(self, server_url: str, jwt_token: str, timeout_s: int = 30):
        if not server_url:
            raise ValueError("Missing OpenMetadata server URL")
        if not jwt_token:
            raise ValueError("Missing OpenMetadata JWT token")
        self.base = server_url.rstrip("/") + "/api/v1"
        self.timeout = timeout_s
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {jwt_token}",
            }
        )

    def _get(self, path: str, params: Dict[str, Any] | None = None) -> Any:
        resp = self.session.get(
            f"{self.base}{path}",
            params=params,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def _put(self, path: str, json_body: Any) -> Any:
        resp = self.session.put(
            f"{self.base}{path}",
            json=json_body,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def _patch(self, path: str, json_body: Any) -> Any:
        resp = self.session.patch(
            f"{self.base}{path}",
            json=json_body,
            timeout=self.timeout,
            headers={
                **self.session.headers,
                "Content-Type": "application/json-patch+json",
            },
        )
        resp.raise_for_status()
        return resp.json()

    # ── Search ──────────────────────────────────────────────

    def search(
        self,
        query: str,
        index: str = "table_search_index",
        start: int = 0,
        size: int = 15,
    ) -> List[OMSearchResult]:
        """Search OpenMetadata entities (tables, topics, etc.)."""
        data = self._get(
            "/search/query",
            params={
                "q": query,
                "index": index,
                "from": start,
                "size": size,
            },
        )
        results: List[OMSearchResult] = []
        for hit in (data.get("hits") or {}).get("hits") or []:
            src = hit.get("_source") or {}
            results.append(
                OMSearchResult(
                    fqn=src.get("fullyQualifiedName") or src.get("name", ""),
                    entity_type=src.get("entityType") or index,
                    name=src.get("name") or src.get("displayName") or "",
                    description=src.get("description"),
                    service=src.get("service", {}).get("name")
                    if isinstance(src.get("service"), dict)
                    else None,
                )
            )
        return results

    # ── Tables ──────────────────────────────────────────────

    def get_table_by_fqn(
        self, fqn: str, fields: str = "tags,columns,owner"
    ) -> Dict[str, Any]:
        return self._get(
            f"/tables/name/{quote(fqn, safe='')}", params={"fields": fields}
        )

    def get_table_tags(self, fqn: str) -> List[Dict[str, Any]]:
        tbl = self.get_table_by_fqn(fqn, fields="tags")
        return tbl.get("tags") or []

    def get_table_owner(self, fqn: str) -> Optional[Dict[str, Any]]:
        tbl = self.get_table_by_fqn(fqn, fields="owner")
        return tbl.get("owner")

    # ── Tags ────────────────────────────────────────────────

    def add_tag_to_table(
        self,
        table_id: str,
        tag_fqn: str,
        label_type: str = "Manual",
        source: str = "Classification",
    ) -> Any:
        """Add a tag to a table using JSON Patch."""
        return self._patch(
            f"/tables/{table_id}",
            json_body=[
                {
                    "op": "add",
                    "path": "/tags/0",
                    "value": {
                        "tagFQN": tag_fqn,
                        "labelType": label_type,
                        "source": source,
                    },
                }
            ],
        )

    # ── Glossary terms ──────────────────────────────────────

    def list_glossaries(self) -> List[Dict[str, Any]]:
        data = self._get("/glossaries", params={"limit": 100})
        return data.get("data") or []

    def list_glossary_terms(
        self, glossary_id: str | None = None, limit: int = 100
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {"limit": limit}
        if glossary_id:
            params["glossary"] = glossary_id
        data = self._get("/glossaryTerms", params=params)
        return data.get("data") or []

    def get_glossary_term_by_fqn(self, fqn: str) -> Dict[str, Any]:
        return self._get(f"/glossaryTerms/name/{quote(fqn, safe='')}")

    def search_glossary_terms(
        self, query: str, limit: int = 25
    ) -> List[OMSearchResult]:
        return self.search(query, index="glossary_term_search_index", size=limit)

    # ── Lineage ─────────────────────────────────────────────

    def get_lineage(self, entity_type: str, fqn: str, depth: int = 1) -> Dict[str, Any]:
        """Get lineage graph for an entity."""
        return self._get(
            f"/lineage/{entity_type}/name/{quote(fqn, safe='')}",
            params={"upstreamDepth": depth, "downstreamDepth": depth},
        )

    def get_table_lineage(self, fqn: str, depth: int = 1) -> Dict[str, Any]:
        return self.get_lineage("table", fqn, depth)
