from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import Request

from govhub.services.assets import normalize_str as _normalize_str


def audit_asset_snapshot(
    asset_fqn: str,
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    from runtime_app import _asset_detail_payload

    try:
        payload = _asset_detail_payload(asset_fqn, request=request, sections=["header"])
    except Exception:
        return {"fqn": asset_fqn}
    return {
        "fqn": payload.get("fqn") or asset_fqn,
        "description": payload.get("description"),
        "domain": payload.get("domain"),
        "tier": payload.get("tier"),
        "certification": payload.get("certification"),
        "sensitivity": payload.get("sensitivity"),
        "criticality": payload.get("criticality"),
        "dataProduct": payload.get("dataProduct") or payload.get("data_product"),
        "governanceStatus": payload.get("governanceStatus"),
        "owners": payload.get("owners") or [],
        "tagEntries": payload.get("tagEntries") or [],
    }


def audit_column_snapshot(
    asset_fqn: str,
    column_name: str,
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    from runtime_app import _asset_detail_payload

    try:
        payload = _asset_detail_payload(asset_fqn, request=request, sections=["schema"])
    except Exception:
        return {"assetFqn": asset_fqn, "columnName": column_name}
    column_records = payload.get("columns") or []
    column = next(
        (
            record
            for record in column_records
            if _normalize_str(record.get("name")).lower()
            == _normalize_str(column_name).lower()
        ),
        None,
    )
    if not column:
        return {"assetFqn": asset_fqn, "columnName": column_name}
    return {
        "assetFqn": asset_fqn,
        "columnName": column_name,
        "description": column.get("description"),
        "dataType": column.get("type"),
        "tags": column.get("tags") or [],
        "glossaryTerm": column.get("glossaryTerm"),
    }


def record_audit_log(
    *,
    entity_type: str,
    action: str,
    actor_email: str,
    actor_role: str,
    entity_fqn: str | None = None,
    entity_id: str | None = None,
    column_name: str | None = None,
    request_id: str | None = None,
    before: Any = None,
    after: Any = None,
    source: str = "api",
    detail: str | None = None,
) -> None:
    from runtime_app import _store

    try:
        store = _store()
        if hasattr(store, "append_metadata_audit_log"):
            store.append_metadata_audit_log(
                entity_type=entity_type,
                action=action,
                actor_email=actor_email,
                actor_role=actor_role,
                entity_fqn=entity_fqn,
                entity_id=entity_id,
                column_name=column_name,
                request_id=request_id,
                before_json=before,
                after_json=after,
                source=source,
                detail=detail,
            )
        else:
            store.append_metadata_audit(
                entity_type=entity_type,
                action=action,
                actor_email=actor_email,
                actor_role=actor_role,
                entity_fqn=entity_fqn,
                entity_id=entity_id,
                column_name=column_name,
                request_id=request_id,
                before=before,
                after=after,
                source=source,
                detail=detail,
            )
    except Exception:
        return
