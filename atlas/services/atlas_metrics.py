"""Composite Governance Atlas presentation payloads.

The functions in this module adapt existing Unity Catalog inventory and
governance-store reads into stable view models for the North Star UI. They do
not create workflow state or narrative metrics; missing signals remain
unavailable so callers can render degraded states truthfully.
"""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
import datetime as dt
import json
import math
from numbers import Integral, Real
import os
import re
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


def _json_safe(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    if isinstance(value, pd.Timestamp):
        return None if pd.isna(value) else value.isoformat()
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    if isinstance(value, Integral) and not isinstance(value, bool):
        return int(value)
    if isinstance(value, Real) and not isinstance(value, bool):
        numeric = float(value)
        return numeric if math.isfinite(numeric) else None
    try:
        if value is not None and pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


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


def _mapping_from_json(value: Any) -> Dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return dict(parsed) if isinstance(parsed, Mapping) else {}
    return {}


def _row_tag_text(row: Mapping[str, Any], *keys: str) -> str:
    direct = _row_text(row, *keys)
    if direct:
        return direct
    for payload in (
        row.get("tags"),
        row.get("ucTags"),
        row.get("tableTags"),
        row.get("new_uc_tags"),
        row.get("new_uc_tags_json"),
    ):
        tags = _mapping_from_json(payload)
        if not tags:
            continue
        for key in keys:
            candidates = {
                key,
                key.replace("-", "_"),
                key.replace("_", "-"),
                key.replace("_", ""),
            }
            for candidate in candidates:
                value = tags.get(candidate)
                if _has_value(value):
                    return _text(value)
    return ""


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
        rows.append({str(key): _json_safe(value) for key, value in row.to_dict().items()})
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


def _command_center_preferred_catalogs() -> set[str]:
    raw = os.getenv("GOVAT_COMMAND_CENTER_PRIMARY_CATALOGS", "") or os.getenv("GOVAT_PRIMARY_BUSINESS_CATALOGS", "")
    return {
        _text(item).lower()
        for item in raw.split(",")
        if _text(item)
    }


def _governance_catalogs() -> set[str]:
    return {
        _text(os.getenv("GOVAT_CATALOG")).lower(),
    } - {""}


def _catalog_business_rank(catalog: Any) -> int:
    normalized = _text(catalog).lower()
    if not normalized:
        return 9
    preferred = _command_center_preferred_catalogs()
    if normalized in preferred:
        return 0
    if normalized in _governance_catalogs():
        return 2
    return 1


def owner_count_for_row(row: Mapping[str, Any]) -> int:
    try:
        owners = asset_service.owner_entries(pd.Series(row))
    except Exception:
        owners = []
    return len(owners)


def metadata_coverage_for_row(row: Mapping[str, Any] | pd.Series) -> float:
    row_map = _row_dict(row)
    total = 7
    present = 0

    if _has_value(_row_value(row_map, "comment", "description")):
        present += 1
    for key_group in (
        ("domain",),
        ("tier",),
        ("certification",),
        ("sensitivity",),
        ("criticality", "business_criticality", "businessCriticality"),
        ("data_product", "dataProduct"),
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


def _change_requests_source(
    store: Any,
    *,
    status: str | None = None,
    limit: int = 200,
) -> tuple[List[Dict[str, Any]], bool, str]:
    kwargs: Dict[str, Any] = {}
    if status:
        kwargs["status"] = status
    return _store_records(store, "list_change_requests", limit=limit, **kwargs)


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
        action = _text(row.get("action"))
        event_text = " ".join(
            _lower(row.get(key))
            for key in ("action", "detail", "entity_fqn", "source", "status")
        )
        priority = ""
        severity = ""
        if status == "failed" or any(
            token in event_text
            for token in ("policy exception", "critical", "p0", "p1", "high priority")
        ):
            priority = "high"
            severity = "high"
        events.append(
            {
                "id": _text(row.get("audit_id")) or _text(row.get("id")),
                "title": _event_title(action),
                "detail": _text(row.get("detail"))
                or _text(row.get("entity_fqn"))
                or _text(row.get("entity_id")),
                "createdAt": _text(row.get("created_at")) or _text(row.get("createdAt")),
                "actorEmail": _text(row.get("actor_email")) or _text(row.get("actorEmail")),
                "tone": "bad" if status == "failed" else "info",
                "status": _text(row.get("status")) or "Success",
                "priority": priority,
                "severity": severity,
            }
        )
    return events


def _timestamp(value: Any) -> pd.Timestamp | None:
    if not _has_value(value):
        return None
    try:
        ts = pd.to_datetime(value, utc=True, errors="coerce")
    except Exception:
        return None
    if pd.isna(ts):
        return None
    return ts


def _series_anchor(timestamps: Sequence[pd.Timestamp]) -> pd.Timestamp:
    values = [ts for ts in timestamps if ts is not None]
    if values:
        return max(values)
    return pd.Timestamp.utcnow()


def _sparkline_points(anchor: pd.Timestamp, *, days: int = 30, buckets: int = 6) -> List[pd.Timestamp]:
    start = anchor - pd.Timedelta(days=days)
    if buckets <= 1:
        return [anchor]
    step = pd.Timedelta(days=days) / (buckets - 1)
    return [start + step * index for index in range(buckets)]


def _format_delta(delta: int, *, suffix: str = "vs 30 days ago") -> str:
    if delta > 0:
        return f"+{delta} {suffix}"
    if delta < 0:
        return f"-{abs(delta)} {suffix}"
    return f"0 {suffix}"


def _open_request_trend(request_rows: Sequence[Mapping[str, Any]]) -> Dict[str, Any]:
    rows = list(request_rows)
    if not rows:
        return {}
    timestamps: List[pd.Timestamp] = []
    prepared: List[tuple[pd.Timestamp | None, pd.Timestamp | None, str]] = []
    for row in rows:
        created = _timestamp(row.get("created_at") or row.get("createdAt"))
        closed = _timestamp(row.get("reviewed_at") or row.get("reviewedAt") or row.get("updated_at") or row.get("updatedAt"))
        if created is not None:
            timestamps.append(created)
        if closed is not None:
            timestamps.append(closed)
        prepared.append((created, closed, _lower(row.get("status"))))
    if not timestamps:
        return {}
    anchor = _series_anchor(timestamps)
    points = _sparkline_points(anchor)

    def count_open(point: pd.Timestamp) -> int:
        count = 0
        for created, closed, status in prepared:
            if created is None or created > point:
                continue
            if status in {"approved", "rejected", "closed", "resolved", "cancelled", "canceled"} and closed is not None and closed <= point:
                continue
            if status in {"approved", "rejected", "closed", "resolved", "cancelled", "canceled"} and closed is None:
                continue
            count += 1
        return count

    sparkline = [count_open(point) for point in points]
    delta = sparkline[-1] - sparkline[0]
    return {
        "sparkline": sparkline,
        "delta": _format_delta(delta),
        "deltaTone": "bad" if delta > 0 else "good" if delta < 0 else "warn",
    }


def _policy_exception_trend(
    request_rows: Sequence[Mapping[str, Any]],
    audit_rows: Sequence[Mapping[str, Any]],
) -> Dict[str, Any]:
    events: List[pd.Timestamp] = []
    for row in [*request_rows, *audit_rows]:
        if _policy_exception_count([row], []) <= 0 and _policy_exception_count([], [row]) <= 0:
            continue
        ts = _timestamp(row.get("created_at") or row.get("createdAt") or row.get("updated_at") or row.get("updatedAt"))
        if ts is not None:
            events.append(ts)
    if not events:
        return {}
    anchor = _series_anchor(events)
    points = _sparkline_points(anchor)
    sparkline = [sum(1 for ts in events if ts <= point) for point in points]
    delta = sparkline[-1] - sparkline[0]
    return {
        "sparkline": sparkline,
        "delta": _format_delta(delta),
        "deltaTone": "warn",
    }


def _event_title(action: str) -> str:
    text = _text(action)
    if not text:
        return "Metadata Event"
    words = [
        word
        for word in text.replace("_", "-").replace("/", "-").split("-")
        if word.strip()
    ]
    if not words:
        return text
    return " ".join(word.capitalize() for word in words)


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


def _catalog_health_summary(assets_df: pd.DataFrame) -> List[Dict[str, Any]]:
    catalogs: Dict[str, Dict[str, Any]] = {}
    severity_rank = {"Unavailable": 0, "Low": 1, "Medium": 2, "High": 3}
    for _, row in assets_df.iterrows():
        row_map = row.to_dict()
        catalog = _row_text(row_map, "table_catalog", "catalog")
        if not catalog:
            fqn = _row_text(row_map, "fqn", "full_name", "fullName")
            catalog = fqn.split(".")[0] if "." in fqn else ""
        if not catalog:
            continue
        current = catalogs.setdefault(
            catalog,
            {
                "name": catalog,
                "catalog": catalog,
                "assetCount": 0,
                "coverageValues": [],
                "classificationCounts": {},
                "risk": "Unavailable",
            },
        )
        current["assetCount"] += 1
        current["coverageValues"].append(metadata_coverage_for_row(row_map))
        classification = _row_text(
            row_map,
            "classification",
            "sensitivity",
            "sensitivity_label",
            "sensitivityLabel",
        )
        if classification:
            counts = current["classificationCounts"]
            counts[classification] = counts.get(classification, 0) + 1
        risk = _row_text(row_map, "risk", "risk_level", "riskLevel", "criticality")
        risk_lower = risk.lower()
        if risk_lower in {"critical", "high", "restricted"}:
            risk_label = "High"
        elif risk_lower in {"medium", "moderate", "confidential"}:
            risk_label = "Medium"
        elif risk:
            risk_label = "Low"
        else:
            risk_label = current["risk"]
        if severity_rank.get(risk_label, 0) > severity_rank.get(current["risk"], 0):
            current["risk"] = risk_label

    rows: List[Dict[str, Any]] = []
    for catalog, info in catalogs.items():
        coverage_values = info.get("coverageValues") or []
        classification_counts = info.get("classificationCounts") or {}
        classification = (
            sorted(
                classification_counts.items(),
                key=lambda item: (-int(item[1]), item[0].lower()),
            )[0][0]
            if classification_counts
            else "Unclassified"
        )
        coverage = (
            round(sum(float(value) for value in coverage_values) / len(coverage_values), 1)
            if coverage_values
            else None
        )
        rows.append(
            {
                "name": catalog,
                "catalog": catalog,
                "assetCount": int(info["assetCount"]),
                "tables": int(info["assetCount"]),
                "coverage": coverage,
                "metadataCoverage": coverage,
                "classification": classification,
                "risk": info.get("risk") or "Unavailable",
                "state": "available" if coverage is not None else "unavailable",
            }
        )
    rows.sort(
        key=lambda item: (
            _catalog_business_rank(item.get("catalog") or item.get("name")),
            -int(item.get("assetCount") or 0),
            str(item.get("catalog") or item.get("name") or "").lower(),
        )
    )
    return rows


def _tier_label(value: Any) -> str:
    text = _text(value)
    lower = text.lower()
    if lower in {"tier 1", "t1", "tier-1", "business critical", "critical"}:
        return "Tier 1 - Business Critical"
    if lower in {"tier 2", "t2", "tier-2", "important", "high"}:
        return "Tier 2 - Important"
    if lower in {"tier 3", "t3", "tier-3", "supporting", "medium"}:
        return "Tier 3 - Supporting"
    if lower in {"tier 4", "t4", "tier-4", "other", "low"}:
        return "Tier 4 - Other"
    return text


def _tier_order(label: str) -> tuple[int, str]:
    lower = label.lower()
    if "tier 1" in lower:
        return (1, label)
    if "tier 2" in lower:
        return (2, label)
    if "tier 3" in lower:
        return (3, label)
    if "tier 4" in lower:
        return (4, label)
    return (9, label)


def _certification_coverage_by_tier(assets_df: pd.DataFrame) -> List[Dict[str, Any]]:
    if assets_df.empty:
        return []
    buckets: Dict[str, Dict[str, int]] = {}
    has_tier_signal = False
    for _, row in assets_df.iterrows():
        row_map = row.to_dict()
        tier_value = _row_value(row_map, "tier", "criticality", "business_criticality", "businessCriticality")
        if not _has_value(tier_value):
            continue
        has_tier_signal = True
        label = _tier_label(tier_value)
        bucket = buckets.setdefault(label, {"certified": 0, "total": 0})
        bucket["total"] += 1
        if _is_certified(row_map):
            bucket["certified"] += 1
    if not has_tier_signal:
        return []
    rows: List[Dict[str, Any]] = []
    for label, counts in buckets.items():
        total = counts["total"]
        value = round((counts["certified"] / total) * 100, 1) if total else 0.0
        rows.append(
            {
                "tier": label,
                "label": label,
                "value": value,
                "certified": counts["certified"],
                "total": total,
            }
        )
    rows.sort(key=lambda item: _tier_order(_text(item.get("label"))))
    return rows


def _risk_impact_label(row: Mapping[str, Any]) -> str:
    value = _lower(_row_value(row, "criticality", "business_criticality", "businessCriticality", "tier"))
    if value in {"critical", "mission critical", "business critical", "tier 1", "t1"}:
        return "Very High"
    if value in {"high", "tier 2", "t2", "important"}:
        return "High"
    if value in {"medium", "tier 3", "t3", "supporting"}:
        return "Medium"
    if value in {"low", "tier 4", "t4", "other"}:
        return "Low"
    return "Very Low"


def _risk_likelihood_label(metadata_gap: float) -> str:
    if metadata_gap >= 80:
        return "Very High"
    if metadata_gap >= 60:
        return "High"
    if metadata_gap >= 40:
        return "Medium"
    if metadata_gap >= 20:
        return "Low"
    return "Very Low"


def _risk_heatmap(assets_df: pd.DataFrame) -> List[Dict[str, Any]]:
    if assets_df.empty:
        return []
    has_criticality_signal = False
    counts: Dict[tuple[str, str], int] = {}
    for _, row in assets_df.iterrows():
        row_map = row.to_dict()
        if not _has_value(_row_value(row_map, "criticality", "business_criticality", "businessCriticality", "tier")):
            continue
        has_criticality_signal = True
        impact = _risk_impact_label(row_map)
        likelihood = _risk_likelihood_label(100.0 - metadata_coverage_for_row(row_map))
        counts[(impact, likelihood)] = counts.get((impact, likelihood), 0) + 1
    if not has_criticality_signal:
        return []
    return [
        {
            "row": impact,
            "impact": impact,
            "column": likelihood,
            "likelihood": likelihood,
            "value": count,
            "count": count,
        }
        for (impact, likelihood), count in sorted(counts.items())
    ]


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


def empty_command_center_payload() -> Dict[str, Any]:
    return {
        "estate": {
            "visibleAssetCount": None,
            "catalogCount": None,
            "openRequests": None,
            "coverageScore": None,
        },
        "kpis": [],
        "posture": {"overall": None, "trend": [], "byDomain": [], "heatmap": []},
        "topDomains": [],
        "recentEvents": [],
        "recentAssets": [],
        "governance": {"pendingRequests": []},
        "insights": {"tiles": {}},
        "quickActions": [
            {"key": "discovery", "label": "Open Discovery", "surface": "discovery"},
            {"key": "governance", "label": "Review Governance", "surface": "governance"},
            {"key": "insights", "label": "View Insights", "surface": "insights"},
            {"key": "audit", "label": "Open Audit Trail", "surface": "audit"},
        ],
        "aiPrompts": [],
        "signalAvailability": {},
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
    excluded_non_authoritative_keys: set[str] = set()

    def _trusted_command_rows(rows: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
        trusted: List[Dict[str, Any]] = []
        for row in rows:
            row_map = dict(row)
            if _is_non_authoritative_evidence_row(row_map):
                identity = _text(row_map.get("audit_id") or row_map.get("auditId") or row_map.get("request_id") or row_map.get("requestId"))
                excluded_non_authoritative_keys.add(identity or json.dumps(row_map, default=str, sort_keys=True))
                continue
            trusted.append(row_map)
        return trusted

    pending_requests = _trusted_command_rows(pending_requests)
    all_requests = pending_requests
    if requests_available and not pending_requests:
        all_requests, requests_available, request_reason = _change_requests_with_state(store, limit=200)
        all_requests = _trusted_command_rows(all_requests)
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
    audit = _trusted_command_rows(audit)
    policy_exception_signal = _policy_exception_signal(all_requests, audit)
    policy_exceptions = policy_exception_signal["value"]
    open_request_trend = _open_request_trend(all_requests) if requests_available else {}
    policy_exception_trend = (
        _policy_exception_trend(all_requests, audit)
        if requests_available or audit_available
        else {}
    )
    audit_readiness = None
    domains = _domain_summary(assets_df)
    catalog_health = _catalog_health_summary(assets_df)
    posture_overall = None
    certified_critical_state = (
        "available" if certification_signal_present and criticality_signal_present else "unavailable"
    )
    source_warnings = [
        warning
        for warning in (request_reason if not requests_available else "", audit_reason if not audit_available else "")
        if warning
    ]

    payload = {
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
                **open_request_trend,
            },
            {
                "key": "policyExceptions",
                "label": "Policy Exceptions",
                "value": policy_exceptions,
                "format": "number",
                "state": policy_exception_signal["state"],
                "reason": policy_exception_signal["reason"],
                **policy_exception_trend,
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
        "catalogHealth": catalog_health[:8],
        "recentEvents": _recent_events(audit),
        "recentAssets": recent_assets,
        "governance": {
            "openRequests": open_requests,
            "policyExceptions": policy_exceptions,
            "pendingRequests": pending_requests[:8],
        },
        "dataQuality": {
            "nonAuthoritativeRowsExcluded": len(excluded_non_authoritative_keys),
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
            "primaryCatalog": catalog_health[0]["catalog"] if catalog_health else "",
        },
    }
    return _json_safe(_customer_safe_payload(payload))


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
    raw_request_id = _text(row.get("request_id")) or _text(row.get("requestId"))
    request_id = _customer_safe_text(raw_request_id) if raw_request_id else ""
    request_tags = _mapping_from_json(row.get("new_uc_tags") or row.get("new_uc_tags_json"))
    title = _text(row.get("title")) or _text(row.get("new_comment")) or "Governance request"
    note = _text(row.get("detail")) or _text(row.get("new_comment"))
    status = _text(row.get("status")) or "pending"
    return {
        "requestId": request_id,
        "id": request_id,
        "title": title.split(":", 1)[0] if ":" in title else title,
        "detail": note,
        "type": _text(row.get("request_type")) or _text(row.get("type")),
        "priority": _text(row.get("priority")) or _text(request_tags.get("priority")),
        "status": status.title(),
        "requester": _text(row.get("created_by")) or _text(row.get("requester")),
        "createdAt": _text(row.get("created_at")) or _text(row.get("createdAt")),
        "dueAt": _text(row.get("due_at")) or _text(row.get("dueAt")) or _text(request_tags.get("dueAt") or request_tags.get("due_at")),
        "assetFqn": _text(row.get("uc_full_name")) or _text(row.get("assetFqn")),
        "domain": _text(row.get("domain")) or _text(request_tags.get("domain")),
        "slaState": _text(row.get("sla_state")) or _text(row.get("slaState")) or _text(request_tags.get("slaState") or request_tags.get("sla_state")),
        "assignedTo": _text(row.get("assigned_to")) or _text(row.get("assignedTo")) or _text(request_tags.get("assignedTo") or request_tags.get("assigned_to")),
        "reviewedAt": _text(row.get("reviewed_at")),
        "reviewedBy": _text(row.get("reviewed_by")),
        "reviewNote": _text(row.get("review_note")),
    }


NON_AUTHORITATIVE_EVIDENCE_RE = re.compile(
    r"prototype|mock|fixture|validation[_\s-]*seed|validation sample|"
    r"home[_\s-]*northstar[_\s-]*seed|home[_\s-]*evidence[_\s-]*plane|"
    r"gov[_\s-]*home[_\s-]*evidence|ga[_\s-]*home[_\s-]*seed|"
    r"ga[_\s-]*taxonomy[_\s-]*(?:seed|term|node)|"
    r"seed[_\s-]*source|mock[_\s-]*api",
    flags=re.IGNORECASE,
)


def _contains_non_authoritative_evidence_marker(*values: Any) -> bool:
    parts: List[str] = []
    for value in values:
        if value is None:
            continue
        if isinstance(value, Mapping):
            try:
                parts.append(json.dumps(dict(value), default=str, sort_keys=True))
            except TypeError:
                parts.extend(_text(item) for item in value.values())
            continue
        if isinstance(value, (list, tuple, set)):
            try:
                parts.append(json.dumps(list(value), default=str, sort_keys=True))
            except TypeError:
                parts.extend(_text(item) for item in value)
            continue
        parts.append(_text(value))
    haystack = " ".join(part for part in parts if part)
    return bool(NON_AUTHORITATIVE_EVIDENCE_RE.search(haystack))


def _is_non_authoritative_evidence_row(row: Mapping[str, Any]) -> bool:
    return _contains_non_authoritative_evidence_marker(row)


def governance_workbench_payload(*, store: Any, selected_request_id: str | None = None) -> Dict[str, Any]:
    source_rows, source_available, source_reason = _change_requests_source(store, limit=200)
    trusted_rows = [row for row in source_rows if not _is_non_authoritative_evidence_row(row)]
    excluded_non_authoritative_rows = max(0, len(source_rows) - len(trusted_rows))
    request_pairs = [(row, _request_record(row)) for row in trusted_rows]
    open_pairs = [
        (raw, record)
        for raw, record in request_pairs
        if _lower(record.get("status")) in {"", "pending", "open", "new", "in review", "in_review"}
    ]
    open_requests = [record for _, record in open_pairs]
    policy_exceptions = [
        row
        for row in open_requests
        if "policy" in _lower(row.get("title")) and "exception" in _lower(row.get("title"))
    ]
    open_request_ids = {_text(row.get("requestId")) for row in open_requests}
    selected_id = (
        selected_request_id
        if selected_request_id and selected_request_id in open_request_ids
        else (open_requests[0]["requestId"] if open_requests else "")
    )
    selected_raw = next(
        (raw for raw, record in open_pairs if _text(record.get("requestId")) == selected_id),
        None,
    )
    selected = _governance_request_detail_from_row(selected_raw) if selected_raw else None
    payload = {
        "metrics": [
            {"key": "pendingApprovals", "label": "Pending Approvals", "value": len(open_requests)},
            {"key": "overdueItems", "label": "Overdue Items", "value": None, "state": "unavailable"},
            {"key": "policyExceptions", "label": "Policy Exceptions", "value": len(policy_exceptions)},
            {"key": "slaPerformance", "label": "SLA Performance", "value": None, "state": "unavailable"},
        ],
        "requests": open_requests,
        "selectedRequest": selected,
        "meta": {
            "sourceAvailable": source_available,
            "sourceReason": source_reason,
            "nonAuthoritativeRowsExcluded": excluded_non_authoritative_rows,
        },
    }
    return _json_safe(_customer_safe_payload(payload))


def _governance_request_detail_from_row(row: Mapping[str, Any]) -> Dict[str, Any] | None:
    row = _row_dict(row)
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
    return _json_safe(_customer_safe_payload({
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
        "commentsState": "unavailable",
        "evidence": [],
        "evidenceState": "unavailable",
    }))


def governance_request_detail_payload(*, store: Any, request_id: str) -> Dict[str, Any] | None:
    if not request_id:
        return None
    request_id = resolve_customer_safe_request_id(store, request_id)
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
    if _is_non_authoritative_evidence_row(row):
        return None
    return _governance_request_detail_from_row(row)


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
    audit_readiness = None
    quality_df = _call_store(store, "list_quality_run_results", limit=1000)
    quality_health = None
    policy_compliance = None
    policy_exception_signal = _policy_exception_signal(_change_requests(store, limit=200), audit)

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
            {"key": "policyCompliance", "label": "Policy Compliance", "value": policy_compliance, "format": "percent", "state": "unavailable", "reason": "No authoritative policy-compliance evaluation source is configured."},
            {"key": "resolutionDays", "label": "Time to Resolution (P1)", "value": None, "state": "unavailable"},
            {"key": "certifiedAssets", "label": "Certified Assets", "value": certified},
            {
                "key": "criticalExceptions",
                "label": "Critical Policy Exceptions",
                "value": policy_exception_signal["value"],
                "state": policy_exception_signal["state"],
                "reason": policy_exception_signal["reason"],
                "source": "governance-request-and-audit-text" if policy_exception_signal["state"] == "degraded" else "",
            },
            {"key": "metadataCoverage", "label": "Metadata Coverage", "value": metadata_coverage, "format": "percent"},
        ],
        "policyComplianceTrend": [],
        "resolutionTrend": [],
        "metadataCoverageHeatmap": _coverage_heatmap(domains),
        "certificationCoverageByTier": _certification_coverage_by_tier(assets_df),
        "riskHeatmap": _risk_heatmap(assets_df),
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
            "quality": quality_health is not None,
            "qualityRowsAvailable": isinstance(quality_df, pd.DataFrame),
            "audit": bool(audit),
            "auditReadiness": audit_readiness is not None,
            "policyCompliance": policy_compliance is not None,
            "policyExceptions": policy_exception_signal["state"],
        },
    }


def taxonomy_overview_payload(
    *,
    store: Any,
    glossary_terms: Sequence[Mapping[str, Any]] | None = None,
) -> Dict[str, Any]:
    initial_limit = 160
    glossary = (
        _records(pd.DataFrame(list(glossary_terms)), limit=initial_limit)
        if glossary_terms is not None
        else _records(_call_store(store, "list_glossary_terms", limit=initial_limit), limit=initial_limit)
    )
    classifications = _records(_call_store(store, "list_classifications"), limit=initial_limit)
    classification_terms: List[Dict[str, Any]] = []
    for classification in classifications:
        classification_id = _row_text(classification, "classification_id", "classificationId", "id")
        if not classification_id:
            continue
        classification_terms.extend(
            _records(_call_store(store, "list_classification_terms", classification_id), limit=initial_limit)
        )
    payload = {
        "classifications": classifications,
        "classificationTerms": classification_terms[:initial_limit],
        "domains": _records(_call_store(store, "list_domains"), limit=initial_limit),
        "dataProducts": _records(_call_store(store, "list_data_products"), limit=initial_limit),
        "columnGroups": _records(_call_store(store, "list_logical_column_groups"), limit=initial_limit),
        "glossaryTerms": glossary,
        "summary": {
            "termCount": len(glossary),
            "initialLimit": initial_limit,
        },
    }
    return _customer_safe_payload(payload)


def _customer_safe_text(value: Any) -> str:
    text_value = _text(value)
    if not text_value:
        return text_value
    if _contains_non_authoritative_evidence_marker(text_value):
        return ""
    text_value = re.sub(
        r"\bGOV-HOME-EVIDENCE-request-(\d+)\b",
        lambda match: f"GOV-{int(match.group(1)):02d}",
        text_value,
        flags=re.IGNORECASE,
    )
    text_value = re.sub(
        r"\bGOV-HOME-EVIDENCE-audit-(\d+)\b",
        lambda match: f"AUD-{int(match.group(1)):02d}",
        text_value,
        flags=re.IGNORECASE,
    )
    text_value = re.sub(
        r"\bga-home-evidence-request-(\d+)\b",
        lambda match: f"GOV-{int(match.group(1)):02d}",
        text_value,
        flags=re.IGNORECASE,
    )
    text_value = re.sub(
        r"\bga-home-evidence-audit-(\d+)\b",
        lambda match: f"AUD-{int(match.group(1)):02d}",
        text_value,
        flags=re.IGNORECASE,
    )
    text_value = re.sub(
        r"\bga-taxonomy-term-([a-z0-9-]+)\b",
        lambda match: match.group(1).replace("-", " ").title(),
        text_value,
        flags=re.IGNORECASE,
    )
    text_value = re.sub(
        r"\bga-taxonomy-node-([a-z0-9-]+)\b",
        lambda match: match.group(1).replace("-", " ").title(),
        text_value,
        flags=re.IGNORECASE,
    )
    replacements = [
        ("quality-evidence-runner", "quality-control-plane"),
        ("home-northstar", "command-center-evidence"),
        ("metadata-audit rows", "governance audit log"),
        ("app-owned glossary evidence", "governance glossary evidence"),
    ]
    for needle, replacement in replacements:
        text_value = text_value.replace(needle, replacement)
    return text_value


def resolve_customer_safe_request_id(store: Any, request_id: str) -> str:
    """Resolve a customer-facing evidence ID back to the backed request ID."""
    candidate = _text(request_id)
    if not candidate:
        return candidate
    request = _call_store(store, "get_change_request", candidate)
    if _row_dict(request):
        return candidate
    safe_candidate = _customer_safe_text(candidate)
    candidate_numbers: list[str] = []
    number_match = re.match(r"^GOV-(\d+)$", safe_candidate, flags=re.IGNORECASE)
    if number_match:
        digits = number_match.group(1)
        candidate_numbers.extend([digits, str(int(digits))])
    rows = _change_requests(store, limit=500)
    for row in rows:
        raw = _text(row.get("request_id") or row.get("requestId"))
        if not raw:
            continue
        if raw == candidate or _customer_safe_text(raw).lower() == safe_candidate.lower():
            return raw
        raw_number = re.search(r"(?:request-|GOV-)(\d+)$", raw, flags=re.IGNORECASE)
        if raw_number and raw_number.group(1).lstrip("0") in {value.lstrip("0") for value in candidate_numbers}:
            return raw
    return candidate


def _customer_safe_payload(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _customer_safe_payload(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_customer_safe_payload(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_customer_safe_payload(item) for item in value)
    if isinstance(value, str):
        return _customer_safe_text(value)
    return value


def _customer_safe_audit_row(row: Mapping[str, Any], index: int = 0) -> Dict[str, Any]:
    safe = _customer_safe_payload(dict(row))
    raw_audit_id = _text(row.get("audit_id") or row.get("auditId"))
    safe["displayAuditId"] = f"AUD-{index + 1:04d}"
    if raw_audit_id and re.search(r"^AUD[-_]", raw_audit_id, flags=re.IGNORECASE):
        safe["audit_id"] = _customer_safe_text(raw_audit_id)
    else:
        safe["audit_id"] = f"AUD-{index + 1:04d}"
    raw_request_id = _text(row.get("request_id") or row.get("requestId"))
    if raw_request_id:
        safe["displayRequestId"] = _customer_safe_text(raw_request_id)
        safe["request_id"] = safe["displayRequestId"]
    # Raw before/after JSON often contains internal store keys and
    # actor-routing metadata. The customer API exposes event identity and status,
    # but the raw diff is intentionally redacted until a governed evidence-export
    # contract can decide which fields are safe to show.
    for key in ("before_json", "beforeJson", "before", "after_json", "afterJson", "after"):
        if key in safe:
            safe[key] = ""
    safe["diffState"] = "redacted"
    safe["diffReason"] = "Raw before/after metadata is redacted from the customer API; use the event ID to retrieve governed evidence through an approved export path."
    entity_fqn = _text(row.get("entity_fqn") or row.get("entityFqn") or row.get("asset_fqn") or row.get("assetFqn"))
    entity_id = _text(row.get("entity_id") or row.get("entityId"))
    if entity_fqn:
        safe["object_label"] = entity_fqn
    elif entity_id:
        safe["object_label"] = _customer_safe_text(entity_id)
    source = _lower(row.get("source"))
    if source == "store":
        safe["display_source"] = "Governance store"
    elif "quality" in source:
        safe["display_source"] = "Quality operations evidence"
    elif "home" in source or "command" in source:
        safe["display_source"] = "Command center evidence"
    elif "taxonomy" in source or "glossary" in source:
        safe["display_source"] = "Glossary governance workflow"
    else:
        safe["display_source"] = _customer_safe_text(row.get("source")) or "Governance audit log"
    return safe


def _is_customer_visible_audit_row(row: Mapping[str, Any]) -> bool:
    if _is_non_authoritative_evidence_row(row):
        return False
    haystack = " ".join(
        _text(row.get(key))
        for key in ("entity_type", "entity_id", "action", "detail", "source")
    )
    return not re.search(
        r"identity[_ -]?directory|identity-directory-upserted|actor_entry_id|assignee_entry_id|reviewer_entry_id",
        haystack,
        flags=re.IGNORECASE,
    )


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
    owner = owners[0]["name"] if owners else ""
    certification = _row_text(row, "certification") or "Unassigned"
    sensitivity = _row_text(row, "sensitivity") or "Unassigned"
    criticality = _row_text(row, "criticality", "business_criticality", "businessCriticality") or "Unassigned"
    source_column = _row_tag_text(
        row,
        "cde_source_column",
        "source_column",
        "sourceColumn",
        "source_of_record_column",
    )
    source_column_fqn = f"{fqn}.{source_column}" if fqn and source_column and "." not in source_column else source_column
    recert_window = _row_tag_text(row, "cde_recert_window", "recert", "reviewWindow")
    source_backed = bool(source_column_fqn)
    return {
        "id": fqn or name,
        "name": name,
        "assetFqn": fqn,
        "column": source_column_fqn,
        "sourceColumn": source_column_fqn,
        "domain": _row_text(row, "domain") or "Unassigned",
        "owner": owner,
        "sensitivity": sensitivity,
        "criticality": criticality,
        "controlCoverage": None,
        "controlState": "unavailable",
        "linkedPolicies": None,
        "linkedPolicyState": "unavailable",
        "downstreamImpact": "Unavailable",
        "certification": certification,
        "lastReview": "Unavailable",
        "recert": recert_window or "Unavailable",
        "status": "Source backed" if source_backed else "Control evidence unavailable",
        "recertEvidence": (
            "Review cadence is backed by Unity Catalog CDE registry tags; mutation workflow evidence is unavailable."
            if recert_window
            else "Recertification workflow evidence unavailable."
        ),
        "healthEvidence": (
            "Source-of-record column is backed by Unity Catalog CDE registry tags."
            if source_backed
            else "Quality/test-run evidence unavailable."
        ),
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
            "protectedCdes": None,
            "sensitiveCandidates": len(protected),
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


def _audit_window_start(date_range: str | None) -> pd.Timedelta | None:
    value = _lower(date_range)
    if value in {"24h", "1d"}:
        return pd.Timedelta(hours=24)
    if value in {"7d", "1w"}:
        return pd.Timedelta(days=7)
    if value in {"30d", "1m"}:
        return pd.Timedelta(days=30)
    return None


def _filter_audit_rows_by_range(rows: Sequence[Mapping[str, Any]], date_range: str | None) -> List[Dict[str, Any]]:
    window = _audit_window_start(date_range)
    if window is None:
        return [dict(row) for row in rows]
    now = pd.Timestamp.utcnow()
    cutoff = now - window
    filtered: List[Dict[str, Any]] = []
    for row in rows:
        timestamp = _timestamp(row.get("created_at") or row.get("createdAt") or row.get("updated_at") or row.get("updatedAt"))
        if timestamp is not None and timestamp >= cutoff:
            filtered.append(dict(row))
    return filtered


def _filter_audit_rows_by_visible_assets(
    rows: Sequence[Mapping[str, Any]],
    visible_asset_fqns: Sequence[str] | None,
) -> List[Dict[str, Any]]:
    if visible_asset_fqns is None:
        return [dict(row) for row in rows]
    visible_keys = {_lower(value) for value in visible_asset_fqns if _has_value(value)}
    filtered: List[Dict[str, Any]] = []
    for row in rows:
        entity_fqn = _text(
            row.get("entity_fqn")
            or row.get("entityFqn")
            or row.get("asset_fqn")
            or row.get("assetFqn")
        )
        if entity_fqn and _lower(entity_fqn) not in visible_keys:
            continue
        filtered.append(dict(row))
    return filtered


def audit_evidence_payload(
    *,
    store: Any,
    audit_id: str | None = None,
    date_range: str | None = None,
    limit: int = 200,
    visible_asset_fqns: Sequence[str] | None = None,
) -> Dict[str, Any]:
    ranged_audit = _filter_audit_rows_by_range(_audit_rows(store, limit=limit), date_range)
    scoped_audit = _filter_audit_rows_by_visible_assets(ranged_audit, visible_asset_fqns)
    audit = [row for row in scoped_audit if _is_customer_visible_audit_row(row)]
    safe_audit = [_customer_safe_audit_row(row, index) for index, row in enumerate(audit)]
    selected = None
    if audit_id:
        selected = next(
            (
                row
                for raw, row in zip(audit, safe_audit)
                if _text(raw.get("audit_id")) == _text(audit_id)
                or _text(row.get("audit_id")) == _text(audit_id)
                or _text(row.get("displayAuditId")) == _text(audit_id)
            ),
            None,
        )
    elif safe_audit:
        selected = safe_audit[0]
    failed = [row for row in audit if _lower(row.get("status")) == "failed"]
    policy = [row for row in audit if "policy" in _lower(row.get("action")) or "policy" in _lower(row.get("detail"))]
    approvals = [row for row in audit if "approv" in _lower(row.get("action")) or "approv" in _lower(row.get("detail"))]
    return {
        "summary": {
            "totalChanges": len(audit),
            "dateRange": _text(date_range),
            "policyChanges": len(policy),
            "approvals": len(approvals),
            "failedActions": len(failed),
            "summarySource": "governance audit log",
            "rowScope": "visible-assets" if visible_asset_fqns is not None else "governance audit log",
            "hiddenRowsExcluded": max(0, len(ranged_audit) - len(audit)),
        },
        "events": safe_audit,
        "selectedEvent": selected,
        "evidence": {
            "before": "",
            "after": "",
            "diffState": selected.get("diffState") if selected else "unavailable",
            "diffReason": selected.get("diffReason") if selected else "No selected audit event.",
            "approvalChain": [],
            "artifacts": [],
            "linkedRequest": selected.get("request_id") if selected else "",
        }
        if selected
        else None,
    }


def _admin_policy_requirements(command: Mapping[str, Any]) -> Dict[str, Any]:
    policy_kpi = next(
        (
            item
            for item in command.get("kpis", [])
            if isinstance(item, Mapping) and item.get("key") == "policyExceptions"
        ),
        {},
    )
    exception_value = policy_kpi.get("value")
    exception_state = _text(policy_kpi.get("state")) or ("available" if exception_value is not None else "unavailable")
    unavailable_reason = "No authoritative policy library or control-enforcement source is configured."
    cards = [
        {"key": "totalPolicies", "label": "Total Policies", "value": None, "state": "unavailable", "reason": unavailable_reason},
        {"key": "requiredPolicies", "label": "Required Policies", "value": None, "state": "unavailable", "reason": unavailable_reason},
        {"key": "enforcedPolicies", "label": "Enforced Policies", "value": None, "state": "unavailable", "reason": unavailable_reason},
        {"key": "atRisk", "label": "At Risk", "value": None, "state": "unavailable", "reason": unavailable_reason},
        {
            "key": "exceptions",
            "label": "Exceptions",
            "value": exception_value,
            "state": exception_state,
            "reason": _text(policy_kpi.get("reason")) or "Derived only from backed policy-exception audit/request text.",
        },
    ]
    by_domain = [
        {
            "domain": _text(row.get("domain") or row.get("label")) or "Unassigned",
            "required": None,
            "enforced": None,
            "coverage": None,
            "trend": [],
            "state": "unavailable",
            "metadataCoverage": row.get("score", row.get("value")),
            "assetCount": row.get("assetCount"),
            "reason": unavailable_reason,
        }
        for row in command.get("posture", {}).get("byDomain", [])[:5]
        if isinstance(row, Mapping)
    ]
    return {
        "cards": cards,
        "byDomain": by_domain,
        "compliance": {
            "score": None,
            "state": "unavailable",
            "reason": unavailable_reason,
            "segments": [
                {"key": "compliant", "label": "Compliant", "value": None, "state": "unavailable"},
                {"key": "atRisk", "label": "At Risk", "value": None, "state": "unavailable"},
                {"key": "nonCompliant", "label": "Non-Compliant", "value": None, "state": "unavailable"},
            ],
        },
        "capabilities": {
            "policyLibrary": False,
            "policyCoverage": False,
            "controlEnforcement": False,
        },
    }


def _admin_access_summary(store: Any) -> Dict[str, Any]:
    roles_df = _safe_df(_call_store(store, "list_roles"))
    identities_df = _safe_df(_call_store(store, "list_identity_directory_entries", active_only=True))
    identity_available = not identities_df.empty
    roles_available = not roles_df.empty

    def principal_count(*types: str) -> int | None:
        if not identity_available or "principal_type" not in identities_df.columns:
            return None
        wanted = {item.lower() for item in types}
        return int(
            identities_df["principal_type"]
            .fillna("")
            .astype(str)
            .str.lower()
            .isin(wanted)
            .sum()
        )

    return {
        "users": {"value": principal_count("user"), "state": "available" if identity_available else "unavailable"},
        "roles": {"value": int(len(roles_df.index)) if roles_available else None, "state": "available" if roles_available else "unavailable"},
        "groups": {"value": principal_count("group"), "state": "available" if identity_available else "unavailable"},
        "apiClients": {"value": principal_count("service_principal", "api_client"), "state": "available" if identity_available else "unavailable"},
        "sso": {"value": None, "state": "unavailable", "reason": "SSO configuration is not exposed by the current runtime diagnostics."},
        "mfa": {"value": None, "state": "unavailable", "reason": "MFA requirements are not exposed by the current runtime diagnostics."},
    }


def _admin_runtime_summary(runtime: Mapping[str, Any] | None, *, ai_status: Mapping[str, Any] | None = None) -> Dict[str, Any]:
    runtime = runtime or {}
    client = runtime.get("client") if isinstance(runtime.get("client"), Mapping) else {}
    return {
        "state": _text(runtime.get("state")) or "unavailable",
        "message": _text(runtime.get("message")),
        "catalogCount": runtime.get("catalogCount"),
        "authMode": _text(client.get("authMode") or client.get("authType")),
        "warehouseId": _text(client.get("warehouseId")),
        "workspaceId": _text(client.get("workspaceId")),
        "host": _text(client.get("host")),
        "ai": {
            "provider": _text(ai_status.get("provider") if ai_status else ""),
            "state": _text(ai_status.get("state") if ai_status else "") or "unavailable",
            "spaceId": _text(ai_status.get("spaceId") if ai_status else ""),
        },
    }


def _admin_integrations(
    *,
    visible_asset_count: int | None,
    audit_rows: Sequence[Mapping[str, Any]],
    pending_requests: Sequence[Mapping[str, Any]],
    ai_status: Mapping[str, Any] | None = None,
) -> List[Dict[str, Any]]:
    ai_state = _text(ai_status.get("state") if ai_status else "") or "unavailable"
    return [
        {
            "key": "unityCatalog",
            "label": "Unity Catalog",
            "subtitle": "Workspace inventory",
            "state": "connected" if visible_asset_count is not None else "unavailable",
            "health": "Healthy" if visible_asset_count is not None else "Unavailable",
        },
        {
            "key": "lineageService",
            "label": "Lineage Service",
            "subtitle": "Unity Catalog lineage",
            "state": "unavailable",
            "health": "Unavailable",
            "reason": "Dedicated lineage service health is not exposed by the current Admin payload.",
        },
        {
            "key": "aiCopilot",
            "label": "AI Copilot",
            "subtitle": "Atlas AI Genie",
            "state": "connected" if ai_state == "available" else ai_state,
            "health": "Healthy" if ai_state == "available" else "Unavailable",
        },
        {
            "key": "notifications",
            "label": "Notifications",
            "subtitle": "In-app delivery",
            "state": "unavailable",
            "health": "Unavailable",
            "reason": "Notification delivery health is not exposed by the current Admin payload.",
        },
    ]


def admin_control_center_payload(
    *,
    visible_assets: pd.DataFrame,
    store: Any,
    runtime: Mapping[str, Any] | None = None,
    environment: Mapping[str, Any] | None = None,
    actor_role: str | None = None,
    ai_status: Mapping[str, Any] | None = None,
    jobs: Sequence[Mapping[str, Any]] | None = None,
) -> Dict[str, Any]:
    command = command_center_payload(visible_assets=visible_assets, store=store)
    audit = _audit_rows(store, limit=10)
    pending_requests = command.get("governance", {}).get("pendingRequests", [])
    visible_asset_count = command.get("estate", {}).get("visibleAssetCount")
    return {
        "coverage": {
            "metadataCoverage": command["estate"]["coverageScore"],
            "byDomain": command["posture"]["byDomain"],
        },
        "environment": dict(environment or {}),
        "role": {
            "value": _text(actor_role) or "unavailable",
            "label": "Platform Admin" if _lower(actor_role) == "admin" else (_text(actor_role).title() if actor_role else "Unavailable"),
            "state": "available" if actor_role else "unavailable",
        },
        "policyRequirements": _admin_policy_requirements(command),
        "branding": {
            "companyName": "Entrada",
            "productName": "Governance Atlas",
            "logo": "entrada-wordmark.svg",
            "primaryColor": "#35b7ff",
            "accentColor": "#22c5d5",
            "theme": "Dark (Default)",
            "favicon": "app default",
            "editable": False,
            "reason": "Brand editing is not backed by a persisted settings API yet.",
        },
        "bulkImport": {
            "state": "unavailable",
            "message": "Bulk import status is available only when backed import jobs are recorded.",
            "uploadStatus": None,
            "validationSummary": {"total": None, "valid": None, "warnings": None, "errors": None},
            "history": [],
            "reportAvailable": False,
        },
        "jobs": [dict(job) for job in (jobs or [])],
        "jobsState": "available" if jobs else "unavailable",
        "jobsReason": "" if jobs else "No Databricks Jobs API rows were returned for this runtime.",
        "integrations": _admin_integrations(
            visible_asset_count=visible_asset_count,
            audit_rows=audit,
            pending_requests=pending_requests,
            ai_status=ai_status,
        ),
        "access": _admin_access_summary(store),
        "runtimeSummary": _admin_runtime_summary(runtime, ai_status=ai_status),
        "system": _admin_runtime_summary(runtime, ai_status=ai_status),
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


def _merge_recommendation_sets(
    recommendation_sets: Sequence[Sequence[Mapping[str, Any]]],
    *,
    limit: int = 3,
) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for recommendations in recommendation_sets:
        for recommendation in recommendations:
            title = _text(recommendation.get("title"))
            detail = _text(recommendation.get("detail"))
            evidence_key = "|".join(
                ":".join(
                    [
                        _text(evidence.get("type")),
                        _text(evidence.get("id")),
                        _text(evidence.get("metric")),
                        _text(evidence.get("value")),
                    ]
                )
                for evidence in recommendation.get("evidence", [])
                if isinstance(evidence, Mapping)
            )
            key = "|".join(part for part in (title.lower(), detail.lower(), evidence_key.lower()) if part)
            if not key or key in seen:
                continue
            seen.add(key)
            merged.append(dict(recommendation))
            if len(merged) >= limit:
                return merged
    return merged


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
        merged_recommendations = _merge_recommendation_sets(candidate_sets, limit=3)
        if merged_recommendations:
            return _ai_response(question=question, intent=intent, recommendations=merged_recommendations)
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
