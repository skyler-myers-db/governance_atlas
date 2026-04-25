"""Composite Governance Atlas presentation payloads.

The functions in this module adapt existing Unity Catalog inventory and
governance-store reads into stable view models for the North Star UI. They do
not create workflow state or narrative metrics; missing signals remain
unavailable so callers can render degraded states truthfully.
"""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from typing import Any, Dict, Iterable, List, Mapping, Sequence

import pandas as pd

from atlas.services import assets as asset_service
from atlas.services import insights as insights_service


REQUIRED_METADATA_FIELDS = (
    "description",
    "comment",
    "domain",
    "tier",
    "certification",
    "sensitivity",
    "criticality",
    "business_criticality",
    "data_product",
)

CRITICALITY_VALUES = {
    "critical",
    "high",
    "mission critical",
    "business critical",
    "tier 1",
    "t1",
}

CERTIFIED_VALUES = {"certified", "approved", "gold", "trusted"}
UNASSIGNED_VALUES = {"", "unassigned", "none", "null", "n/a", "na", "unknown", "—"}


def _safe_df(value: Any) -> pd.DataFrame:
    return value if isinstance(value, pd.DataFrame) else pd.DataFrame()


def _safe_count(df: pd.DataFrame | None) -> int:
    try:
        return int(len(df.index))
    except Exception:
        return 0


def _text(value: Any) -> str:
    try:
        if value is None or pd.isna(value):
            return ""
    except Exception:
        pass
    return str(value or "").strip()


def _lower(value: Any) -> str:
    return _text(value).lower()


def _has_value(value: Any) -> bool:
    return _lower(value) not in UNASSIGNED_VALUES


def _row_value(row: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row and _has_value(row.get(key)):
            return row.get(key)
    return ""


def _row_text(row: Mapping[str, Any], *keys: str) -> str:
    return _text(_row_value(row, *keys))


def _row_dict(row: Any) -> Dict[str, Any]:
    if isinstance(row, pd.Series):
        return row.to_dict()
    if isinstance(row, Mapping):
        return dict(row)
    if is_dataclass(row):
        return asdict(row)
    if hasattr(row, "__dict__"):
        return dict(row.__dict__)
    return {}


def _records(df: Any, limit: int = 200) -> List[Dict[str, Any]]:
    frame = _safe_df(df)
    if frame.empty:
        return []
    rows: List[Dict[str, Any]] = []
    for _, row in frame.head(max(0, int(limit))).iterrows():
        rows.append({str(key): value for key, value in row.to_dict().items()})
    return rows


def _call_store(store: Any, method: str, *args: Any, **kwargs: Any) -> Any:
    fn = getattr(store, method, None)
    if not callable(fn):
        return None
    try:
        return fn(*args, **kwargs)
    except Exception:
        return None


def _store_records(
    store: Any,
    method: str,
    *,
    limit: int = 200,
    **kwargs: Any,
) -> tuple[List[Dict[str, Any]], bool, str]:
    fn = getattr(store, method, None)
    if not callable(fn):
        return [], False, f"{method} is not available on the governance store."
    try:
        return _records(fn(limit=limit, **kwargs), limit=limit), True, ""
    except Exception as exc:
        return [], False, f"{method} failed: {_text(exc) or exc.__class__.__name__}."


def _normalize_asset_fqn(value: Any) -> str:
    return _text(value)


def _asset_name(fqn: str) -> str:
    return _text(fqn).split(".")[-1] if _text(fqn) else ""


def _catalog_count(assets_df: pd.DataFrame) -> int:
    if assets_df.empty:
        return 0
    catalogs: set[str] = set()
    for _, row in assets_df.iterrows():
        row_map = row.to_dict()
        catalog = _row_text(row_map, "table_catalog", "catalog")
        if not catalog:
            fqn = _row_text(row_map, "fqn")
            catalog = fqn.split(".")[0] if "." in fqn else ""
        if catalog:
            catalogs.add(catalog)
    return len(catalogs)


def owner_count_for_row(row: Mapping[str, Any]) -> int:
    try:
        owners = asset_service.owner_entries(pd.Series(row))
    except Exception:
        owners = []
    return len(owners)


def metadata_coverage_for_row(row: Mapping[str, Any] | pd.Series) -> float:
    row_map = _row_dict(row)
    total = 6
    present = 0

    if _has_value(_row_value(row_map, "comment", "description")):
        present += 1
    for key_group in (
        ("domain",),
        ("tier",),
        ("certification",),
        ("sensitivity",),
        ("criticality", "business_criticality", "businessCriticality"),
    ):
        if _has_value(_row_value(row_map, *key_group)):
            present += 1

    total += 1
    if owner_count_for_row(row_map):
        present += 1

    return round((present / total) * 100, 1) if total else 0.0


def _metadata_dimensions_for_row(row: Mapping[str, Any]) -> Dict[str, bool]:
    return {
        "Discoverability": _has_value(_row_value(row, "comment", "description")),
        "Ownership": owner_count_for_row(row) > 0,
        "Classification": any(
            _has_value(_row_value(row, key))
            for key in ("certification", "sensitivity", "tier")
        ),
        "Criticality": _has_value(
            _row_value(row, "criticality", "business_criticality", "businessCriticality")
        ),
        "Data Product": _has_value(_row_value(row, "data_product", "dataProduct")),
    }


def _is_certified(row: Mapping[str, Any]) -> bool:
    return _lower(_row_value(row, "certification")) in CERTIFIED_VALUES


def _is_critical(row: Mapping[str, Any]) -> bool:
    value = _lower(
        _row_value(
            row,
            "criticality",
            "business_criticality",
            "businessCriticality",
            "tier",
        )
    )
    return value in CRITICALITY_VALUES


def _policy_exception_count(request_rows: Sequence[Mapping[str, Any]], audit_rows: Sequence[Mapping[str, Any]]) -> int:
    count = 0
    for row in [*request_rows, *audit_rows]:
        text = " ".join(
            _text(row.get(key))
            for key in ("title", "new_comment", "detail", "action", "entity_fqn")
        ).lower()
        if "policy exception" in text or "exception" in text and "policy" in text:
            count += 1
    return count


def _policy_exception_signal(
    request_rows: Sequence[Mapping[str, Any]],
    audit_rows: Sequence[Mapping[str, Any]],
) -> Dict[str, Any]:
    count = _policy_exception_count(request_rows, audit_rows)
    if count <= 0:
        return {
            "value": None,
            "state": "unavailable",
            "reason": "No authoritative policy-exception signal is available.",
        }
    return {
        "value": count,
        "state": "degraded",
        "reason": "Derived from governance request and audit text until a dedicated policy-exception source is available.",
    }


def _change_requests(store: Any, *, status: str | None = None, limit: int = 200) -> List[Dict[str, Any]]:
    kwargs: Dict[str, Any] = {"limit": limit}
    if status:
        kwargs["status"] = status
    return _records(_call_store(store, "list_change_requests", **kwargs), limit=limit)


def _change_requests_with_state(
    store: Any,
    *,
    status: str | None = None,
    limit: int = 200,
) -> tuple[List[Dict[str, Any]], bool, str]:
    kwargs: Dict[str, Any] = {}
    if status:
        kwargs["status"] = status
    return _store_records(store, "list_change_requests", limit=limit, **kwargs)


def _audit_rows(store: Any, *, limit: int = 200, entity_fqn: str | None = None) -> List[Dict[str, Any]]:
    kwargs: Dict[str, Any] = {"limit": limit}
    if entity_fqn:
        kwargs["entity_fqn"] = entity_fqn
    audit = _call_store(store, "list_metadata_audit", **kwargs)
    if audit is None:
        audit = _call_store(store, "list_audit_events", **kwargs)
    return _records(audit, limit=limit)


def _audit_rows_with_state(
    store: Any,
    *,
    limit: int = 200,
    entity_fqn: str | None = None,
) -> tuple[List[Dict[str, Any]], bool, str]:
    kwargs: Dict[str, Any] = {}
    if entity_fqn:
        kwargs["entity_fqn"] = entity_fqn
    rows, available, reason = _store_records(store, "list_metadata_audit", limit=limit, **kwargs)
    if available:
        return rows, True, ""
    fallback_rows, fallback_available, fallback_reason = _store_records(
        store,
        "list_audit_events",
        limit=limit,
        **kwargs,
    )
    if fallback_available:
        return fallback_rows, True, ""
    return [], False, reason or fallback_reason or "Audit source is not available."


def _recent_events(audit_rows: Sequence[Mapping[str, Any]], limit: int = 8) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for row in list(audit_rows)[:limit]:
        status = _lower(row.get("status"))
        events.append(
            {
                "id": _text(row.get("audit_id")) or _text(row.get("id")),
                "title": _text(row.get("action")) or "Metadata event",
                "detail": _text(row.get("detail"))
                or _text(row.get("entity_fqn"))
                or _text(row.get("entity_id")),
                "createdAt": _text(row.get("created_at")) or _text(row.get("createdAt")),
                "actorEmail": _text(row.get("actor_email")) or _text(row.get("actorEmail")),
                "tone": "bad" if status == "failed" else "info",
                "status": _text(row.get("status")) or "Success",
            }
        )
    return events


def _domain_summary(assets_df: pd.DataFrame) -> List[Dict[str, Any]]:
    domains: Dict[str, Dict[str, Any]] = {}
    for _, row in assets_df.iterrows():
        row_map = row.to_dict()
        domain = _row_text(row_map, "domain") or "Unassigned"
        current = domains.setdefault(
            domain,
            {
                "domain": domain,
                "assetCount": 0,
                "coverageValues": [],
                "dimensions": {},
            },
        )
        current["assetCount"] += 1
        current["coverageValues"].append(metadata_coverage_for_row(row_map))
        for key, present in _metadata_dimensions_for_row(row_map).items():
            bucket = current["dimensions"].setdefault(key, {"present": 0, "total": 0})
            bucket["total"] += 1
            if present:
                bucket["present"] += 1

    results: List[Dict[str, Any]] = []
    for domain, info in domains.items():
        values = info["coverageValues"]
        score = round(sum(values) / len(values), 1) if values else 0.0
        heatmap = [
            {
                "metric": key,
                "value": round((counts["present"] / counts["total"]) * 100, 1)
                if counts["total"]
                else None,
            }
            for key, counts in info["dimensions"].items()
        ]
        results.append(
            {
                "domain": domain,
                "label": domain,
                "score": score,
                "value": score,
                "assetCount": int(info["assetCount"]),
                "metrics": heatmap,
            }
        )
    results.sort(key=lambda item: (-float(item["score"]), item["domain"].lower()))
    return results


def _coverage_heatmap(domain_summary: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    cells: List[Dict[str, Any]] = []
    for item in domain_summary[:8]:
        domain = _text(item.get("domain"))
        for metric in item.get("metrics") or []:
            cells.append(
                {
                    "row": domain,
                    "column": _text(metric.get("metric")),
                    "value": metric.get("value"),
                }
            )
    return cells


def _estate_from_assets(
    assets_df: pd.DataFrame,
    *,
    open_requests: int | None,
    metadata_coverage: float | None,
) -> Dict[str, Any]:
    return {
        "visibleAssetCount": _safe_count(assets_df),
        "catalogCount": _catalog_count(assets_df),
        "openRequests": open_requests,
        "coverageScore": metadata_coverage,
    }


def command_center_payload(*, visible_assets: pd.DataFrame, store: Any) -> Dict[str, Any]:
    assets_df = _safe_df(visible_assets)
    total_assets = _safe_count(assets_df)
    coverage_values = [
        metadata_coverage_for_row(row)
        for _, row in assets_df.iterrows()
    ]
    metadata_coverage = round(sum(coverage_values) / len(coverage_values), 1) if coverage_values else None
    certified_assets = 0
    critical_assets = 0
    certified_critical_assets = 0
    certification_signal_present = False
    criticality_signal_present = False
    recent_assets: List[Dict[str, Any]] = []

    for _, row in assets_df.iterrows():
        row_map = row.to_dict()
        if _has_value(_row_value(row_map, "certification")):
            certification_signal_present = True
        if _has_value(_row_value(row_map, "criticality", "business_criticality", "businessCriticality", "tier")):
            criticality_signal_present = True
        certified = _is_certified(row_map)
        critical = _is_critical(row_map)
        if certified:
            certified_assets += 1
        if critical:
            critical_assets += 1
        if certified and critical:
            certified_critical_assets += 1
        if len(recent_assets) < 6:
            recent_assets.append(asset_service.base_asset_payload(pd.Series(row_map)))

    pending_requests, requests_available, request_reason = _change_requests_with_state(
        store,
        status="pending",
        limit=200,
    )
    all_requests = pending_requests
    if requests_available and not pending_requests:
        all_requests, requests_available, request_reason = _change_requests_with_state(store, limit=200)
    open_requests = (
        len(
            [
                row
                for row in all_requests
                if _lower(row.get("status")) in {"", "pending", "open", "in_review", "new"}
            ]
        )
        if requests_available
        else None
    )
    audit, audit_available, audit_reason = _audit_rows_with_state(store, limit=50)
    policy_exception_signal = _policy_exception_signal(all_requests, audit)
    policy_exceptions = policy_exception_signal["value"]
    audit_readiness = None
    domains = _domain_summary(assets_df)
    posture_overall = None
    certified_critical_state = (
        "available" if certification_signal_present and criticality_signal_present else "unavailable"
    )
    source_warnings = [
        warning
        for warning in (request_reason if not requests_available else "", audit_reason if not audit_available else "")
        if warning
    ]

    return {
        "estate": _estate_from_assets(
            assets_df,
            open_requests=open_requests,
            metadata_coverage=metadata_coverage,
        ),
        "kpis": [
            {
                "key": "governedAssets",
                "label": "Governed Assets",
                "value": total_assets,
                "format": "number",
            },
            {
                "key": "certifiedCriticalAssets",
                "label": "Certified Critical Assets",
                "value": certified_critical_assets if certified_critical_state == "available" else None,
                "format": "number",
                "state": certified_critical_state,
                "reason": (
                    ""
                    if certified_critical_state == "available"
                    else "Certification and criticality signals are required before certified critical assets can be counted."
                ),
            },
            {
                "key": "metadataCoverage",
                "label": "Metadata Coverage",
                "value": metadata_coverage,
                "format": "percent",
                "progress": metadata_coverage,
                "state": "available" if metadata_coverage is not None else "unavailable",
            },
            {
                "key": "openStewardship",
                "label": "Open Stewardship Actions",
                "value": open_requests,
                "format": "number",
                "state": "available" if requests_available else "unavailable",
                "reason": "" if requests_available else "Governance request source is unavailable.",
            },
            {
                "key": "policyExceptions",
                "label": "Policy Exceptions",
                "value": policy_exceptions,
                "format": "number",
                "state": policy_exception_signal["state"],
                "reason": policy_exception_signal["reason"],
            },
            {
                "key": "auditReadiness",
                "label": "Audit Readiness",
                "value": audit_readiness,
                "format": "percent",
                "progress": audit_readiness,
                "state": "unavailable",
                "reason": "Audit readiness requires a documented control-coverage formula before it is shown as a score.",
            },
        ],
        "posture": {
            "overall": posture_overall,
            "state": "unavailable",
            "reason": "Overall posture requires a documented composite formula beyond metadata coverage.",
            "trend": [],
            "byDomain": domains[:8],
            "heatmap": _coverage_heatmap(domains),
        },
        "topDomains": domains[:5],
        "recentEvents": _recent_events(audit),
        "recentAssets": recent_assets,
        "governance": {
            "openRequests": open_requests,
            "policyExceptions": policy_exceptions,
            "pendingRequests": pending_requests[:8],
        },
        "insights": {
            "tiles": {
                "totalAssets": total_assets,
                "certifiedAssets": certified_assets,
                "criticalAssets": critical_assets,
                "metadataCoverage": metadata_coverage,
                "policyExceptions": policy_exceptions,
            },
            "qualitySignalAvailable": False,
        },
        "quickActions": [
            {"key": "discovery", "label": "Open Discovery", "surface": "discovery"},
            {"key": "governance", "label": "Review Governance", "surface": "governance"},
            {"key": "insights", "label": "View Insights", "surface": "insights"},
            {"key": "audit", "label": "Open Audit Trail", "surface": "audit"},
        ],
        "aiPrompts": [
            "Which domains have the lowest metadata coverage?",
            "Which critical assets are not certified?",
            "What changed in governance metadata recently?",
            "Which assets need stewardship attention?",
        ],
        "signalAvailability": {
            "visibleAssets": True,
            "audit": audit_available and bool(audit),
            "quality": False,
            "lineage": False,
        },
        "meta": {
            "warnings": source_warnings,
        },
    }


def asset_360_payload(
    *,
    detail: Mapping[str, Any] | None = None,
    uc: Any = None,
    store: Any = None,
    asset_fqn: str = "",
) -> Dict[str, Any]:
    if detail is None:
        detail = asset_service.asset_detail_payload(
            uc,
            store,
            asset_fqn,
            sections=(
                "header",
                "activity",
                "schema",
                "properties",
                "operational",
                "profiler",
            ),
            allow_direct_metadata_write=False,
        )
    asset = dict(detail or {})
    owners = list(asset.get("owners") or [])
    stewards = [
        owner
        for owner in owners
        if "steward" in _lower(owner.get("title")) or "steward" in _lower(owner.get("name"))
    ]
    badges = [
        value
        for value in (
            asset.get("certification"),
            asset.get("criticality"),
            asset.get("sensitivity"),
            asset.get("domain"),
            asset.get("dataProduct"),
        )
        if _has_value(value)
    ]
    activity = [
        *(asset.get("activity") or []),
        *[
            {
                "id": item.get("id"),
                "title": item.get("action") or "Metadata event",
                "detail": item.get("detail") or item.get("entityId") or "",
                "status": item.get("status") or "",
                "createdAt": item.get("createdAt") or "",
                "createdBy": item.get("createdBy") or item.get("actorEmail") or "",
            }
            for item in (asset.get("metadataAudit") or [])
        ],
    ]
    operational = asset.get("operationalContext") or {}
    consumers = list(operational.get("consumers") or [])
    dashboards = [
        item
        for item in consumers
        if any(token in _lower(item.get("entityLabel") or item.get("entityType")) for token in ("dashboard", "report", "query"))
    ]
    usage = {
        **(asset.get("usage") or {}),
        "downstreamAssetCount": len(asset.get("relatedAssets") or []),
        "downstreamConsumerCount": len(consumers),
        "queryCount": len(asset.get("queries") or []),
    }

    return {
        "asset": asset,
        "owners": owners,
        "stewards": stewards,
        "badges": badges,
        "freshness": {
            "state": "unavailable",
            "observedAt": "",
            "message": "Freshness is unavailable for this asset until a live freshness signal is present.",
        },
        "usage": usage,
        "schema": list(asset.get("columns") or []),
        "governance": {
            "certification": asset.get("certification"),
            "domain": asset.get("domain"),
            "tier": asset.get("tier"),
            "sensitivity": asset.get("sensitivity"),
            "criticality": asset.get("criticality"),
            "dataProduct": asset.get("dataProduct"),
            "glossaryTerms": asset.get("glossaryTerms") or [],
            "ownerAssignments": asset.get("ownerAssignments") or [],
            "openActivity": asset.get("activity") or [],
        },
        "quality": {
            "state": "unavailable",
            "runs": [],
            "message": "Quality runs are not included in this composite payload yet.",
        },
        "access": {
            "state": "unavailable",
            "message": "Access explanation is available from the dedicated asset access endpoint.",
        },
        "activity": activity,
        "relatedAssets": list(asset.get("relatedAssets") or []),
        "downstreamDashboards": dashboards,
        "loadedSections": asset.get("loadedSections") or [],
    }


def _request_record(row: Mapping[str, Any]) -> Dict[str, Any]:
    request_id = _text(row.get("request_id")) or _text(row.get("requestId"))
    title = _text(row.get("title")) or _text(row.get("new_comment")) or "Governance request"
    note = _text(row.get("detail")) or _text(row.get("new_comment"))
    status = _text(row.get("status")) or "pending"
    return {
        "requestId": request_id,
        "id": request_id,
        "title": title.split(":", 1)[0] if ":" in title else title,
        "detail": note,
        "type": _text(row.get("request_type")) or _text(row.get("type")) or "metadata_change",
        "priority": _text(row.get("priority")),
        "status": status.title(),
        "requester": _text(row.get("created_by")) or _text(row.get("requester")),
        "createdAt": _text(row.get("created_at")) or _text(row.get("createdAt")),
        "dueAt": _text(row.get("due_at")) or _text(row.get("dueAt")),
        "assetFqn": _text(row.get("uc_full_name")) or _text(row.get("assetFqn")),
        "domain": _text(row.get("domain")),
        "reviewedAt": _text(row.get("reviewed_at")),
        "reviewedBy": _text(row.get("reviewed_by")),
        "reviewNote": _text(row.get("review_note")),
    }


def governance_workbench_payload(*, store: Any, selected_request_id: str | None = None) -> Dict[str, Any]:
    requests = [_request_record(row) for row in _change_requests(store, limit=200)]
    open_requests = [
        row
        for row in requests
        if _lower(row.get("status")) in {"", "pending", "open", "new", "in review", "in_review"}
    ]
    policy_exceptions = [
        row
        for row in requests
        if "policy" in _lower(row.get("title")) and "exception" in _lower(row.get("title"))
    ]
    selected_id = selected_request_id or (requests[0]["requestId"] if requests else "")
    selected = governance_request_detail_payload(store=store, request_id=selected_id) if selected_id else None
    return {
        "metrics": [
            {"key": "pendingApprovals", "label": "Pending Approvals", "value": len(open_requests)},
            {"key": "overdueItems", "label": "Overdue Items", "value": None, "state": "unavailable"},
            {"key": "policyExceptions", "label": "Policy Exceptions", "value": len(policy_exceptions)},
            {"key": "slaPerformance", "label": "SLA Performance", "value": None, "state": "unavailable"},
        ],
        "requests": requests,
        "selectedRequest": selected,
    }


def governance_request_detail_payload(*, store: Any, request_id: str) -> Dict[str, Any] | None:
    if not request_id:
        return None
    request = _call_store(store, "get_change_request", request_id)
    row = _row_dict(request)
    if not row:
        matches = [
            item
            for item in _change_requests(store, limit=200)
            if _text(item.get("request_id")) == request_id
        ]
        row = matches[0] if matches else {}
    if not row:
        return None
    record = _request_record(row)
    after = row.get("new_uc_tags")
    if not isinstance(after, dict):
        after = {}
    if row.get("new_comment"):
        after = {**after, "description": _text(row.get("new_comment"))}
    diff_rows = [
        {"field": key, "label": key.replace("_", " ").title(), "before": "", "after": value}
        for key, value in sorted(after.items())
        if _has_value(value)
    ]
    return {
        **record,
        "diff": {"before": {}, "after": after, "rows": diff_rows},
        "businessContext": _text(row.get("new_comment")),
        "assetImpact": {"assetFqn": record.get("assetFqn")},
        "approverFlow": [
            {
                "label": "Requested",
                "actor": record.get("requester"),
                "state": "complete",
                "at": record.get("createdAt"),
            },
            {
                "label": "Review",
                "actor": _text(row.get("reviewed_by")),
                "state": "complete" if _has_value(row.get("reviewed_by")) else "pending",
                "at": _text(row.get("reviewed_at")),
            },
        ],
        "comments": [],
        "evidence": [],
    }


def insights_dashboard_payload(*, visible_assets: pd.DataFrame, store: Any) -> Dict[str, Any]:
    assets_df = _safe_df(visible_assets)
    total_assets = _safe_count(assets_df)
    coverage_values = [metadata_coverage_for_row(row) for _, row in assets_df.iterrows()]
    metadata_coverage = round(sum(coverage_values) / len(coverage_values), 1) if coverage_values else 0.0
    certified = sum(1 for _, row in assets_df.iterrows() if _is_certified(row.to_dict()))
    owner_covered = sum(1 for _, row in assets_df.iterrows() if owner_count_for_row(row.to_dict()) > 0)
    certification_coverage = round((certified / total_assets) * 100, 1) if total_assets else 0.0
    ownership_coverage = round((owner_covered / total_assets) * 100, 1) if total_assets else 0.0
    audit = _audit_rows(store, limit=100)
    audit_readiness = 100.0 if audit else None
    quality_df = _call_store(store, "list_quality_run_results", limit=1000)
    quality_available = isinstance(quality_df, pd.DataFrame)
    quality_health = None
    policy_compliance = None
    policy_exceptions = _policy_exception_count(_change_requests(store, limit=200), audit)
    if policy_exceptions == 0 and total_assets:
        policy_compliance = 100.0

    weighted_signals = [
        ("metadataCoverage", 0.30, metadata_coverage),
        ("certificationCoverage", 0.20, certification_coverage),
        ("ownershipCoverage", 0.15, ownership_coverage),
        ("policyCompliance", 0.15, policy_compliance),
        ("qualityHealth", 0.10, quality_health),
        ("auditReadiness", 0.10, audit_readiness),
    ]
    available_weight = sum(weight for _, weight, value in weighted_signals if value is not None)
    maturity = (
        round(sum(weight * float(value) for _, weight, value in weighted_signals if value is not None) / available_weight, 1)
        if available_weight
        else None
    )
    domains = _domain_summary(assets_df)
    recommendations = []
    if domains:
        weakest = sorted(domains, key=lambda item: float(item["score"]))[0]
        if weakest["score"] < 80:
            recommendations.append(
                {
                    "key": "metadataCoverage",
                    "title": f"Improve {weakest['domain']} metadata coverage",
                    "detail": f"{weakest['domain']} has {weakest['score']}% average metadata coverage across {weakest['assetCount']} assets.",
                    "evidence": [
                        {
                            "type": "domain",
                            "id": weakest["domain"],
                            "metric": "metadataCoverage",
                            "value": weakest["score"],
                        }
                    ],
                }
            )

    return {
        "kpis": [
            {"key": "maturity", "label": "Governance Maturity Score", "value": maturity, "format": "score"},
            {"key": "policyCompliance", "label": "Policy Compliance", "value": policy_compliance, "format": "percent", "state": "available" if policy_compliance is not None else "unavailable"},
            {"key": "resolutionDays", "label": "Time to Resolution (P1)", "value": None, "state": "unavailable"},
            {"key": "certifiedAssets", "label": "Certified Assets", "value": certified},
            {"key": "criticalExceptions", "label": "Critical Policy Exceptions", "value": policy_exceptions},
            {"key": "metadataCoverage", "label": "Metadata Coverage", "value": metadata_coverage, "format": "percent"},
        ],
        "policyComplianceTrend": [],
        "resolutionTrend": [],
        "metadataCoverageHeatmap": _coverage_heatmap(domains),
        "certificationCoverageByTier": [],
        "riskHeatmap": [],
        "domainLeaderboard": domains,
        "recommendations": recommendations,
        "scoring": {
            "maturityFormula": [
                {"signal": signal, "weight": weight}
                for signal, weight, _ in weighted_signals
            ],
            "availableSignals": [
                signal for signal, _, value in weighted_signals if value is not None
            ],
        },
        "signalAvailability": {
            "quality": quality_available,
            "audit": bool(audit),
        },
    }


def taxonomy_overview_payload(*, store: Any) -> Dict[str, Any]:
    glossary = _records(_call_store(store, "list_glossary_terms", limit=500), limit=500)
    return {
        "classifications": _records(_call_store(store, "list_classifications"), limit=500),
        "domains": _records(_call_store(store, "list_domains"), limit=500),
        "dataProducts": _records(_call_store(store, "list_data_products"), limit=500),
        "columnGroups": _records(_call_store(store, "list_logical_column_groups"), limit=500),
        "glossaryTerms": glossary,
        "summary": {
            "termCount": len(glossary),
        },
    }


def _is_cde_asset(row: Mapping[str, Any]) -> bool:
    tokens: List[str] = []
    for key in (
        "fqn",
        "table_name",
        "comment",
        "description",
        "criticality",
        "business_criticality",
        "businessCriticality",
        "tags",
        "tagLabels",
        "glossaryTerms",
    ):
        value = row.get(key)
        if isinstance(value, (dict, list, tuple, set)):
            tokens.append(str(value))
        else:
            tokens.append(_text(value))
    haystack = " ".join(tokens).lower()
    return (
        "critical data element" in haystack
        or " cde" in f" {haystack}"
        or _is_critical(row)
    )


def _cde_item(row: Mapping[str, Any]) -> Dict[str, Any]:
    fqn = _row_text(row, "fqn")
    name = _row_text(row, "table_name") or _asset_name(fqn)
    owners = asset_service.owner_entries(pd.Series(row))
    return {
        "id": fqn or name,
        "name": name,
        "assetFqn": fqn,
        "domain": _row_text(row, "domain") or "Unassigned",
        "owner": owners[0]["name"] if owners else "",
        "sensitivity": _row_text(row, "sensitivity") or "Unassigned",
        "criticality": _row_text(row, "criticality", "business_criticality", "businessCriticality") or "Unassigned",
        "controlCoverage": None,
        "controlState": "unavailable",
        "linkedPolicies": None,
        "downstreamImpact": "Unavailable",
        "certification": _row_text(row, "certification") or "Unassigned",
        "lastReview": "",
    }


def cde_dashboard_payload(*, visible_assets: pd.DataFrame) -> Dict[str, Any]:
    assets_df = _safe_df(visible_assets)
    items = [_cde_item(row.to_dict()) for _, row in assets_df.iterrows() if _is_cde_asset(row.to_dict())]
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for item in items:
        grouped.setdefault(item["domain"], []).append(item)
    groups = [
        {"domain": domain, "items": sorted(domain_items, key=lambda value: value["name"].lower())}
        for domain, domain_items in sorted(grouped.items())
    ]
    protected = [
        item
        for item in items
        if _lower(item.get("sensitivity")) not in UNASSIGNED_VALUES
        and _lower(item.get("sensitivity")) != "internal"
    ]
    return {
        "summary": {
            "totalCdes": len(items),
            "protectedCdes": len(protected),
            "overdueReviews": None,
            "domainsCovered": len(grouped),
        },
        "groups": groups,
        "items": items,
    }


def cde_detail_payload(*, visible_assets: pd.DataFrame, cde_id: str) -> Dict[str, Any] | None:
    dashboard = cde_dashboard_payload(visible_assets=visible_assets)
    for item in dashboard["items"]:
        if _text(item.get("id")) == _text(cde_id) or _text(item.get("name")) == _text(cde_id):
            return {
                **item,
                "businessDescription": "",
                "lineageSnapshot": {"state": "unavailable"},
                "controls": [
                    {"name": "Access Control", "state": "unavailable", "coverage": None},
                    {"name": "Data Protection", "state": "unavailable", "coverage": None},
                    {"name": "Data Quality", "state": "unavailable", "coverage": None},
                    {"name": "Monitoring", "state": "unavailable", "coverage": None},
                    {"name": "Retention", "state": "unavailable", "coverage": None},
                ],
                "linkedAssets": [{"assetFqn": item.get("assetFqn")}],
                "activity": [],
            }
    return None


def audit_evidence_payload(*, store: Any, audit_id: str | None = None, limit: int = 200) -> Dict[str, Any]:
    audit = _audit_rows(store, limit=limit)
    selected = None
    if audit_id:
        selected = next((row for row in audit if _text(row.get("audit_id")) == _text(audit_id)), None)
    elif audit:
        selected = audit[0]
    failed = [row for row in audit if _lower(row.get("status")) == "failed"]
    policy = [row for row in audit if "policy" in _lower(row.get("action")) or "policy" in _lower(row.get("detail"))]
    approvals = [row for row in audit if "approv" in _lower(row.get("action")) or "approv" in _lower(row.get("detail"))]
    return {
        "summary": {
            "totalChanges": len(audit),
            "policyChanges": len(policy),
            "approvals": len(approvals),
            "failedActions": len(failed),
        },
        "events": audit,
        "selectedEvent": selected,
        "evidence": {
            "before": selected.get("before_json") if selected else "",
            "after": selected.get("after_json") if selected else "",
            "approvalChain": [],
            "artifacts": [],
            "linkedRequest": selected.get("request_id") if selected else "",
        }
        if selected
        else None,
    }


def admin_control_center_payload(*, visible_assets: pd.DataFrame, store: Any, runtime: Mapping[str, Any] | None = None) -> Dict[str, Any]:
    command = command_center_payload(visible_assets=visible_assets, store=store)
    audit = _audit_rows(store, limit=10)
    return {
        "coverage": {
            "metadataCoverage": command["estate"]["coverageScore"],
            "byDomain": command["posture"]["byDomain"],
        },
        "branding": {
            "companyName": "Entrada",
            "productName": "Governance Atlas",
        },
        "bulkImport": {"state": "unavailable", "message": "Bulk import status is available from the admin import endpoints."},
        "integrations": [
            {
                "key": "unityCatalog",
                "label": "Unity Catalog",
                "state": "connected" if command["estate"]["visibleAssetCount"] is not None else "unavailable",
            },
            {
                "key": "governanceStore",
                "label": "Governance Store",
                "state": "connected" if audit or command["governance"]["pendingRequests"] else "unavailable",
            },
        ],
        "system": dict(runtime or {}),
        "recentAdminActivity": _recent_events(audit, limit=5),
    }


def _ai_question_intent(question: str) -> str:
    text = _lower(question)
    if not text:
        return "priority"
    if any(term in text for term in ("prioritize", "priority", "governance issue", "next")):
        return "priority"
    if any(term in text for term in ("critical", "certified", "certification", "not certified")):
        return "certification"
    if any(term in text for term in ("changed", "change", "recently", "recent", "metadata recently")):
        return "changes"
    if any(term in text for term in ("stewardship", "owner", "ownership")):
        return "stewardship"
    if any(term in text for term in ("coverage", "metadata", "domain", "domains")):
        return "coverage"
    return "unsupported"


def _ai_response(
    *,
    question: str,
    intent: str,
    recommendations: Sequence[Mapping[str, Any]],
    answer: str = "",
    confidence: str | None = None,
    warnings: Sequence[str] | None = None,
) -> Dict[str, Any]:
    evidence = [
        evidence
        for recommendation in recommendations
        for evidence in recommendation.get("evidence", [])
    ]
    return {
        "answer": (
            answer
            or (
                _text(recommendations[0].get("detail"))
                if recommendations
                else "No evidence-backed recommendations are available from the current visible metadata."
            )
        ),
        "question": question,
        "intent": intent,
        "supportedQuestionTypes": [
            "metadata coverage",
            "critical asset certification",
            "recent metadata changes",
            "stewardship and ownership",
            "next governance priority",
        ],
        "recommendations": list(recommendations),
        "evidence": evidence,
        "suggestedActions": [
            action
            for recommendation in recommendations
            for action in recommendation.get("suggestedActions", [])
        ][:4],
        "redaction": {
            "sampleValuesIncluded": False,
            "piiValuesIncluded": False,
        },
        "confidence": confidence or ("evidence-backed" if evidence else "low"),
        "warnings": list(warnings or []),
    }


def _coverage_recommendations(command: Mapping[str, Any]) -> List[Dict[str, Any]]:
    recommendations: List[Dict[str, Any]] = []
    for domain in sorted(command["posture"]["byDomain"], key=lambda item: float(item.get("score") or 0))[:3]:
        if float(domain.get("score") or 0) >= 85:
            continue
        recommendations.append(
            {
                "title": f"Improve {domain['domain']} metadata coverage",
                "detail": f"{domain['domain']} coverage is {domain['score']}% across {domain['assetCount']} visible assets.",
                "evidence": [
                    {
                        "type": "domain",
                        "id": domain["domain"],
                        "metric": "metadataCoverage",
                        "value": domain["score"],
                        "assetCount": domain["assetCount"],
                    }
                ],
                "suggestedActions": [
                    {"label": "Open Discovery", "surface": "discovery"},
                    {"label": "Review Governance", "surface": "governance"},
                ],
            }
        )
    return recommendations


def _critical_certification_recommendations(assets_df: pd.DataFrame) -> tuple[List[Dict[str, Any]], str, bool]:
    critical_signal_available = False
    certification_signal_available = False
    recommendations: List[Dict[str, Any]] = []
    for _, row in assets_df.iterrows():
        row_map = row.to_dict()
        critical_value = _row_text(row_map, "criticality", "business_criticality", "businessCriticality", "tier")
        certification_value = _row_text(row_map, "certification")
        critical_signal_available = critical_signal_available or bool(critical_value)
        certification_signal_available = certification_signal_available or bool(certification_value)
        if not _is_critical(row_map) or _is_certified(row_map):
            continue
        fqn = _row_text(row_map, "fqn", "full_name", "fullName") or ".".join(
            part
            for part in (
                _row_text(row_map, "table_catalog", "catalog"),
                _row_text(row_map, "table_schema", "schema"),
                _row_text(row_map, "table_name", "name"),
            )
            if part
        )
        recommendations.append(
            {
                "title": f"Certify critical asset {_asset_name(fqn) or fqn}",
                "detail": f"{fqn or 'An actor-visible asset'} is marked critical but is not certified.",
                "evidence": [
                    {
                        "type": "asset",
                        "id": fqn,
                        "metric": "criticalCertification",
                        "criticality": critical_value,
                        "certification": certification_value or "missing",
                    }
                ],
                "suggestedActions": [
                    {"label": "Open Discovery", "surface": "discovery"},
                    {"label": "Review Governance", "surface": "governance"},
                ],
            }
        )
    if recommendations:
        return recommendations[:3], "", True
    if critical_signal_available and certification_signal_available:
        return [], "No actor-visible critical assets without certification were found.", True
    return [], "Criticality and certification signals are not available for the current visible metadata.", False


def _stewardship_recommendations(assets_df: pd.DataFrame) -> List[Dict[str, Any]]:
    by_domain: Dict[str, int] = {}
    for _, row in assets_df.iterrows():
        row_map = row.to_dict()
        if owner_count_for_row(row_map) > 0:
            continue
        domain = _row_text(row_map, "domain") or "Unassigned"
        by_domain[domain] = by_domain.get(domain, 0) + 1
    recommendations: List[Dict[str, Any]] = []
    for domain, count in sorted(by_domain.items(), key=lambda item: (-item[1], item[0].lower()))[:3]:
        recommendations.append(
            {
                "title": f"Assign stewardship for {domain}",
                "detail": f"{domain} has {count} actor-visible asset{'s' if count != 1 else ''} without an owner.",
                "evidence": [
                    {
                        "type": "domain",
                        "id": domain,
                        "metric": "assetsWithoutOwner",
                        "value": count,
                    }
                ],
                "suggestedActions": [
                    {"label": "Open Discovery", "surface": "discovery"},
                    {"label": "Review Governance", "surface": "governance"},
                ],
            }
        )
    return recommendations


def _recent_change_recommendations(store: Any) -> List[Dict[str, Any]]:
    recommendations: List[Dict[str, Any]] = []
    for event in _recent_events(_audit_rows(store, limit=8), limit=3):
        title = _text(event.get("title")) or "Metadata event"
        detail = _text(event.get("detail")) or "Metadata changed in the audit log."
        recommendations.append(
            {
                "title": title,
                "detail": f"{title}: {detail}",
                "evidence": [
                    {
                        "type": "audit",
                        "id": event.get("id"),
                        "metric": "metadataChange",
                        "createdAt": event.get("createdAt"),
                        "actorEmail": event.get("actorEmail"),
                    }
                ],
                "suggestedActions": [
                    {"label": "Open Audit Trail", "surface": "audit"},
                ],
            }
        )
    return recommendations


def build_ai_recommendations(*, visible_assets: pd.DataFrame, store: Any, question: str = "") -> Dict[str, Any]:
    command = command_center_payload(visible_assets=visible_assets, store=store)
    assets_df = _safe_df(visible_assets)
    intent = _ai_question_intent(question)
    warnings: List[str] = []

    if intent == "coverage":
        return _ai_response(
            question=question,
            intent=intent,
            recommendations=_coverage_recommendations(command),
        )

    if intent == "certification":
        recommendations, answer, supported = _critical_certification_recommendations(assets_df)
        return _ai_response(
            question=question,
            intent=intent,
            recommendations=recommendations,
            answer=answer,
            confidence="evidence-backed" if supported else "low",
            warnings=[] if supported else [answer],
        )

    if intent == "changes":
        recommendations = _recent_change_recommendations(store)
        return _ai_response(
            question=question,
            intent=intent,
            recommendations=recommendations,
            answer="" if recommendations else "No recent metadata change evidence is available to Atlas AI for the current actor.",
            confidence="evidence-backed" if recommendations else "low",
            warnings=[] if recommendations else ["No recent metadata change evidence is available."],
        )

    if intent == "stewardship":
        recommendations = _stewardship_recommendations(assets_df)
        return _ai_response(
            question=question,
            intent=intent,
            recommendations=recommendations,
            answer="" if recommendations else "No actor-visible stewardship ownership gaps were found.",
            confidence="evidence-backed" if recommendations else "low",
            warnings=[] if recommendations else ["No actor-visible stewardship ownership gaps were found."],
        )

    if intent == "priority":
        candidate_sets = [
            _coverage_recommendations(command),
            _stewardship_recommendations(assets_df),
            _recent_change_recommendations(store),
        ]
        certification_recommendations, certification_answer, certification_supported = _critical_certification_recommendations(assets_df)
        if certification_supported:
            candidate_sets.insert(1, certification_recommendations)
        for recommendations in candidate_sets:
            if recommendations:
                return _ai_response(question=question, intent=intent, recommendations=recommendations)
        if certification_answer:
            warnings.append(certification_answer)
        return _ai_response(
            question=question,
            intent=intent,
            recommendations=[],
            answer="No evidence-backed governance priority is available from the current visible metadata.",
            confidence="low",
            warnings=warnings,
        )

    return _ai_response(
        question=question,
        intent=intent,
        recommendations=[],
        answer=(
            "Atlas AI on Home currently supports evidence-backed questions about metadata coverage, "
            "critical asset certification, recent metadata changes, stewardship, and next governance priority."
        ),
        confidence="low",
        warnings=["Unsupported Home Atlas AI question type."],
    )
