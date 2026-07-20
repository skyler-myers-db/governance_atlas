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
    *,
    sources_available: bool = False,
) -> Dict[str, Any]:
    count = _policy_exception_count(request_rows, audit_rows)
    if count <= 0:
        # Zero is a real (and good) governance answer when the request/audit
        # sources responded. Rendering it as "unavailable" made a healthy
        # estate look broken; only report unavailable when the sources
        # themselves could not be read.
        if sources_available:
            return {
                "value": 0,
                "state": "available",
                "reason": "No policy exceptions recorded in governance requests or the audit trail.",
            }
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


# Internal bookkeeping actions (identity mirroring, projections, alias
# upkeep) are real audit rows but operational noise in an executive
# activity stream — six "Identity Directory Upserted" rows in a row read
# as a broken feed, not governance activity.
_INTERNAL_EVENT_TOKENS = (
    "identity_directory",
    "identity directory",
    "entity_registry",
    "entity registry",
    "entity_alias",
    "entity alias",
    "notification",
    "projection",
    "mirror",
)


def _recent_events(audit_rows: Sequence[Mapping[str, Any]], limit: int = 8) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for row in audit_rows:
        if len(events) >= limit:
            break
        status = _lower(row.get("status"))
        action = _text(row.get("action"))
        # Live audit actions are hyphenated ("identity-directory-upserted");
        # normalize separators so the underscore token list matches all forms.
        normalized_action = action.lower().replace("-", "_").replace(" ", "_")
        if any(token.replace(" ", "_") in normalized_action for token in _INTERNAL_EVENT_TOKENS):
            continue
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
    # Trend windows must end at NOW, not at the newest data timestamp.
    # Anchoring at max(data) made a burst of activity months ago render
    # today as "+40 vs 30 days ago" — a stale window presented as current.
    return pd.Timestamp.now(tz="UTC")


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


def _quality_sla_signal(store: Any) -> Dict[str, Any]:
    """Pass rate over the recent quality-run result ledger.

    SLA = passed / (passed + failed + errored) across the most recent
    result rows (skipped cases excluded). Unavailable only when no
    quality runs have ever recorded results.
    """
    frame = _call_store(store, "list_quality_run_results", limit=2000)
    rows = _rows_or_empty(frame)
    passed = failed = 0
    failed_by_severity = {"high": 0, "medium": 0, "informational": 0}
    for row in rows:
        outcome = _lower(row.get("outcome"))
        if outcome == "passed":
            passed += 1
        elif outcome in {"failed", "errored"}:
            failed += 1
            severity = _lower(row.get("severity"))
            if severity in {"error", "critical", "high", "blocker"}:
                failed_by_severity["high"] += 1
            elif severity in {"info", "informational", "low"}:
                failed_by_severity["informational"] += 1
            else:
                failed_by_severity["medium"] += 1
    scored = passed + failed
    if scored <= 0:
        return {
            "value": None,
            "state": "unavailable",
            "reason": "No quality checks have run yet. Configure expectations from an asset's Quality tab to activate this signal.",
            "checksEvaluated": 0,
            "failedBySeverity": None,
        }
    return {
        "value": round(passed / scored * 100, 1),
        "state": "available",
        "reason": f"Pass rate across the {scored} most recent evaluated quality checks.",
        "checksEvaluated": scored,
        "failedBySeverity": failed_by_severity,
    }


def _rows_or_empty(frame: Any) -> List[Dict[str, Any]]:
    try:
        if frame is None:
            return []
        if isinstance(frame, pd.DataFrame):
            return [] if frame.empty else frame.to_dict("records")
        return [dict(row) for row in frame]
    except Exception:
        return []


# system.access.table_lineage is workspace-sized; cache the distinct-FQN scan
# per warehouse for an hour so the 45s command-center rebuild never repeats it.
_LINEAGE_FQN_CACHE: Dict[str, tuple[float, set[str]]] = {}
_LINEAGE_FQN_CACHE_TTL_S = 3600.0


def _lineage_covered_fqns(system_uc: Any, catalogs: Sequence[str]) -> set[str] | None:
    if system_uc is None or not catalogs:
        return None
    import time as _time

    cache_key = f"{getattr(system_uc, 'warehouse_id', '')}:{','.join(sorted(catalogs))}"
    cached = _LINEAGE_FQN_CACHE.get(cache_key)
    if cached and _time.time() - cached[0] < _LINEAGE_FQN_CACHE_TTL_S:
        return cached[1]
    from atlas.util import sql_literal

    catalog_list = ", ".join(sql_literal(catalog) for catalog in catalogs)
    query = f"""
SELECT DISTINCT asset_fqn FROM (
  SELECT CAST(source_table_full_name AS STRING) AS asset_fqn
  FROM system.access.table_lineage
  WHERE source_table_full_name IS NOT NULL
  UNION ALL
  SELECT CAST(target_table_full_name AS STRING) AS asset_fqn
  FROM system.access.table_lineage
  WHERE target_table_full_name IS NOT NULL
)
WHERE asset_fqn IS NOT NULL AND split(asset_fqn, '[.]')[0] IN ({catalog_list})
LIMIT 50000
"""
    try:
        frame = system_uc.query_df(query)
    except Exception:
        return None
    if frame is None or "asset_fqn" not in getattr(frame, "columns", []):
        return None
    covered = {str(value).lower() for value in frame["asset_fqn"].dropna().tolist()}
    _LINEAGE_FQN_CACHE[cache_key] = (_time.time(), covered)
    return covered


def _lineage_coverage_signal(system_uc: Any, assets_df: pd.DataFrame) -> Dict[str, Any]:
    """Share of visible assets that appear in system.access.table_lineage."""
    fqns = [fqn.lower() for fqn in _extract_asset_fqns(assets_df)]
    if not fqns:
        return {"value": None, "state": "unavailable", "reason": "No visible assets to evaluate lineage coverage against."}
    catalogs = sorted({fqn.split(".")[0] for fqn in fqns if "." in fqn})
    covered = _lineage_covered_fqns(system_uc, catalogs)
    if covered is None:
        return {
            "value": None,
            "state": "unavailable",
            "reason": "system.access.table_lineage is not readable from this warehouse.",
        }
    linked = sum(1 for fqn in fqns if fqn in covered)
    return {
        "value": round(linked / len(fqns) * 100, 1),
        "state": "available",
        "reason": f"{linked} of {len(fqns)} visible assets have recorded Unity Catalog lineage edges.",
        "linkedAssets": linked,
    }


def _extract_asset_fqns(assets_df: pd.DataFrame) -> List[str]:
    for column in ("fqn", "full_name", "fullName", "uc_full_name"):
        if column in getattr(assets_df, "columns", []):
            return [
                _text(value)
                for value in assets_df[column].dropna().astype(str).tolist()
                if _text(value)
            ]
    return []


def _cde_assets(assets_df: pd.DataFrame, *, limit: int = 4) -> tuple[int, List[Dict[str, Any]]]:
    """Count CDE-tagged visible assets and surface the first few as
    registry rows, so the Command Center CDE grid shows real Critical
    Data Elements instead of keyword-matched lookalikes."""
    count = 0
    rows: List[Dict[str, Any]] = []
    for _, row in assets_df.iterrows():
        row_map = _row_dict(row)
        # Same detection the CDE registry surface uses (_is_cde_asset), so
        # the hero "CDEs tracked" count always matches the registry count.
        if not _is_cde_asset(row_map):
            continue
        count += 1
        if len(rows) >= limit:
            continue
        fqn = _normalize_asset_fqn(_row_value(row_map, "fqn", "full_name", "fullName"))
        owners = row_map.get("owners")
        owner = ""
        if isinstance(owners, (list, tuple)) and owners:
            first = owners[0]
            owner = _text(first.get("name") or first.get("email")) if isinstance(first, Mapping) else _text(first)
        if not owner:
            owner = _row_text(row_map, "owner", "owner_email", "ownerEmail", "domain")
        certification = _row_text(row_map, "certification")
        tags_text = json.dumps(row_map.get("tags"), default=str) if row_map.get("tags") else ""
        rows.append(
            {
                "id": fqn or _asset_name(fqn),
                "name": _asset_name(fqn) or _row_text(row_map, "name"),
                "assetFqn": fqn,
                "column": fqn,
                "owner": owner,
                "status": certification if certification and _lower(certification) not in UNASSIGNED_VALUES else "Certification pending",
                "sox": "sox" in tags_text.lower(),
                "state": "available",
            }
        )
    return count, rows


POSTURE_FORMULA = (
    "40% metadata coverage + 25% certification rate + 20% stewardship "
    "responsiveness (open requests vs governed assets) + 15% policy-exception cleanliness"
)


def _posture_score(
    *,
    metadata_coverage: float | None,
    total_assets: int,
    certified_assets: int,
    open_requests: int | None,
    policy_exceptions: int | None,
) -> Dict[str, Any]:
    """Composite governance-posture score (0-100), formula documented in
    POSTURE_FORMULA and surfaced to the UI so the number is auditable."""
    if metadata_coverage is None or total_assets <= 0:
        return {
            "value": None,
            "state": "unavailable",
            "reason": "Posture requires visible assets with backed metadata coverage.",
            "formula": POSTURE_FORMULA,
        }
    certification_component = certified_assets / total_assets * 100
    stewardship_component = (
        (1 - min((open_requests or 0) / total_assets, 1)) * 100
        if open_requests is not None
        else metadata_coverage
    )
    exception_component = (
        max(0.0, 100.0 - 10.0 * policy_exceptions)
        if policy_exceptions is not None
        else metadata_coverage
    )
    score = round(
        0.40 * metadata_coverage
        + 0.25 * certification_component
        + 0.20 * stewardship_component
        + 0.15 * exception_component,
        1,
    )
    return {
        "value": score,
        "state": "available",
        "reason": "Composite posture across coverage, certification, stewardship, and exceptions.",
        "formula": POSTURE_FORMULA,
    }


AUDIT_READINESS_FORMULA = (
    "Share of governed assets that are audit-traceable: documented, owned, "
    "and classified (certification, sensitivity, or tier)"
)


def _audit_readiness_score(assets_df: pd.DataFrame) -> Dict[str, Any]:
    total = _safe_count(assets_df)
    if total <= 0:
        return {
            "value": None,
            "state": "unavailable",
            "reason": "Audit readiness requires visible governed assets.",
            "formula": AUDIT_READINESS_FORMULA,
        }
    ready = 0
    for _, row in assets_df.iterrows():
        dimensions = _metadata_dimensions_for_row(_row_dict(row))
        if dimensions["Discoverability"] and dimensions["Ownership"] and dimensions["Classification"]:
            ready += 1
    return {
        "value": round(ready / total * 100, 1),
        "state": "available",
        "reason": f"{ready} of {total} governed assets are documented, owned, and classified.",
        "formula": AUDIT_READINESS_FORMULA,
    }


# One snapshot write per (scope, day) per process; the store dedupes on
# (scope_key, snapshot_date) too, so restarts stay idempotent.
_SNAPSHOT_WRITTEN: Dict[str, str] = {}


def _record_daily_snapshot(store: Any, scope_key: str, metrics: Mapping[str, Any]) -> None:
    if not hasattr(store, "upsert_governance_metrics_snapshot"):
        return
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    if _SNAPSHOT_WRITTEN.get(scope_key) == today:
        return
    try:
        store.upsert_governance_metrics_snapshot(
            scope_key=scope_key,
            snapshot_date=today,
            metrics=dict(metrics),
        )
        _SNAPSHOT_WRITTEN[scope_key] = today
    except Exception:
        # Trend persistence must never break the live payload.
        pass


def _snapshot_history(store: Any, scope_key: str) -> List[Dict[str, Any]]:
    frame = _call_store(store, "list_governance_metrics_snapshots", scope_key=scope_key)
    rows = _rows_or_empty(frame)
    prepared: List[tuple[Any, Dict[str, Any]]] = []
    for row in rows:
        ts = _timestamp(row.get("snapshot_date"))
        if ts is None:
            continue
        prepared.append((ts, row))
    prepared.sort(key=lambda item: item[0])
    return [
        {**row, "snapshot_date": ts.strftime("%Y-%m-%d")}
        for ts, row in prepared
    ]


def _trend_fields(history: Sequence[Mapping[str, Any]], column: str, *, suffix: str = "vs 30 days ago") -> Dict[str, Any]:
    """Sparkline + previous-value fields for a KPI from snapshot history.

    With a single snapshot the trend is honestly marked "collecting" (with
    the start date) instead of "unavailable" — the signal exists, history
    is simply young.
    """
    points = [
        {"date": row["snapshot_date"], "value": _number(row.get(column))}
        for row in history
        if _number(row.get(column)) is not None
    ]
    if not points:
        return {}
    if len(points) == 1:
        return {
            "sparkline": [points[0]["value"]],
            "trendPoints": points,
            "trendState": "collecting",
            "collectingSince": points[0]["date"],
        }
    latest = points[-1]["value"]
    previous = points[0]["value"]
    delta = latest - previous
    span_days = max(
        1,
        (pd.Timestamp(points[-1]["date"]) - pd.Timestamp(points[0]["date"])).days,
    )
    resolved_suffix = suffix if span_days >= 25 else f"since {points[0]['date']}"
    return {
        "sparkline": [point["value"] for point in points[-12:]],
        "trendPoints": points[-12:],
        "trendState": "available",
        "previousValue": previous,
        "delta": _format_delta(int(round(delta)), suffix=resolved_suffix),
        "deltaTone": "good" if delta >= 0 else "bad",
    }


def _number(value: Any) -> float | None:
    try:
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return None
        numeric = float(value)
        return numeric if math.isfinite(numeric) else None
    except (TypeError, ValueError):
        return None


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


def command_center_payload(
    *,
    visible_assets: pd.DataFrame,
    store: Any,
    scope_key: str = "workspace",
    system_uc: Any = None,
) -> Dict[str, Any]:
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
    policy_exception_signal = _policy_exception_signal(
        all_requests,
        audit,
        sources_available=requests_available or audit_available,
    )
    policy_exceptions = policy_exception_signal["value"]
    open_request_trend = _open_request_trend(all_requests) if requests_available else {}
    policy_exception_trend = (
        _policy_exception_trend(all_requests, audit)
        if requests_available or audit_available
        else {}
    )
    domains = _domain_summary(assets_df)
    catalog_health = _catalog_health_summary(assets_df)
    certified_critical_state = (
        "available" if certification_signal_present and criticality_signal_present else "unavailable"
    )

    # Backed composite + operational signals. Each helper returns an honest
    # unavailable state when its source cannot be read; none of them fabricate.
    quality_signal = _quality_sla_signal(store)
    lineage_signal = _lineage_coverage_signal(system_uc, assets_df)
    cde_count, cde_rows = _cde_assets(assets_df)
    audit_readiness_signal = _audit_readiness_score(assets_df)
    posture_signal = _posture_score(
        metadata_coverage=metadata_coverage,
        total_assets=total_assets,
        certified_assets=certified_assets,
        open_requests=open_requests,
        policy_exceptions=policy_exceptions,
    )

    _record_daily_snapshot(
        store,
        scope_key,
        {
            "governed_assets": total_assets,
            "certified_assets": certified_assets,
            "critical_assets": critical_assets,
            "certified_critical_assets": certified_critical_assets,
            "metadata_coverage": metadata_coverage,
            "posture_score": posture_signal["value"],
            "audit_readiness": audit_readiness_signal["value"],
            "open_requests": open_requests,
            "policy_exceptions": policy_exceptions,
            "quality_sla": quality_signal["value"],
            "lineage_coverage": lineage_signal["value"],
            "cde_count": cde_count,
        },
    )
    history = _snapshot_history(store, scope_key)
    coverage_trend = _trend_fields(history, "metadata_coverage")
    certified_trend = _trend_fields(history, "certified_critical_assets")
    posture_trend_fields = _trend_fields(history, "posture_score")
    quality_trend = _trend_fields(history, "quality_sla")
    lineage_trend = _trend_fields(history, "lineage_coverage")
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
                **certified_trend,
            },
            {
                "key": "metadataCoverage",
                "label": "Metadata Coverage",
                "value": metadata_coverage,
                "format": "percent",
                "progress": metadata_coverage,
                "state": "available" if metadata_coverage is not None else "unavailable",
                **coverage_trend,
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
                "value": audit_readiness_signal["value"],
                "format": "percent",
                "progress": audit_readiness_signal["value"],
                "state": audit_readiness_signal["state"],
                "reason": audit_readiness_signal["reason"],
                "formula": audit_readiness_signal["formula"],
            },
        ],
        "posture": {
            "overall": posture_signal["value"],
            "state": posture_signal["state"],
            "reason": posture_signal["reason"],
            "formula": posture_signal["formula"],
            "trend": posture_trend_fields.get("trendPoints") or [],
            "trendState": posture_trend_fields.get("trendState") or "collecting",
            "collectingSince": posture_trend_fields.get("collectingSince") or "",
            "previousValue": posture_trend_fields.get("previousValue"),
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
            "openRequestAssetCount": len(
                {
                    _lower(row.get("uc_full_name") or row.get("ucFullName") or row.get("entity_fqn"))
                    for row in all_requests
                    if _lower(row.get("status")) in {"", "pending", "open", "in_review", "new"}
                    and _text(row.get("uc_full_name") or row.get("ucFullName") or row.get("entity_fqn"))
                }
            ) if requests_available else None,
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
                "cdeCount": cde_count,
            },
            "qualitySla": quality_signal["value"],
            "previousQualitySla": quality_trend.get("previousValue"),
            "qualitySignalAvailable": quality_signal["state"] == "available",
            "qualityReason": quality_signal["reason"],
            "qualityChecksEvaluated": quality_signal["checksEvaluated"],
            "lineageCoverage": lineage_signal["value"],
            "previousLineageCoverage": lineage_trend.get("previousValue"),
        },
        "lineage": {
            "coverage": lineage_signal["value"],
            "previousCoverage": lineage_trend.get("previousValue"),
            "state": lineage_signal["state"],
            "reason": lineage_signal["reason"],
        },
        # Real severity split from the quality-run result ledger; only
        # emitted when quality checks have actually run, so the risk panel
        # is backed evidence, never an inferred score.
        "riskBreakdown": (
            {
                "high": quality_signal["failedBySeverity"]["high"],
                "medium": quality_signal["failedBySeverity"]["medium"],
                "informational": quality_signal["failedBySeverity"]["informational"],
                "total": sum(quality_signal["failedBySeverity"].values()),
                "source": "quality_run_results",
            }
            if quality_signal.get("failedBySeverity")
            else None
        ),
        "cdes": cde_rows,
        "signalAvailability": {
            "visibleAssets": True,
            "audit": audit_available and bool(audit),
            "quality": quality_signal["state"] == "available",
            "lineage": lineage_signal["state"] == "available",
        },
        "meta": {
            "warnings": source_warnings,
            "primaryCatalog": catalog_health[0]["catalog"] if catalog_health else "",
        },
    }
    payload["estate"]["cdeCount"] = cde_count
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


# Default SLA policy applied when a change request carries no explicit
# due date. Honest labeling: every derived field is marked as coming from
# this default policy, never presented as a recorded due date.
_DEFAULT_SLA_DAYS = 7


def _request_timestamp(value: Any) -> dt.datetime | None:
    """Parse a stored request timestamp to an aware UTC datetime (or None)."""
    text = _text(value)
    if not text:
        return None
    try:
        ts = pd.Timestamp(text)
    except (TypeError, ValueError):
        return None
    if ts is pd.NaT:
        return None
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    return ts.to_pydatetime()


def _synthesized_request_title(
    row: Mapping[str, Any],
    request_tags: Mapping[str, Any],
    asset_fqn: str,
) -> str:
    """Build a meaningful title from the request's actual change content.

    The legacy store rows often carry the literal placeholder
    "Governance request" as new_comment, which rendered 40 identical
    queue rows. Derive the intent from what the request actually changes.
    """
    asset_short = asset_fqn.split(".")[-1] if asset_fqn else ""
    # Request-metadata keys stashed in new_uc_tags_json (migration-free
    # storage) are not tag CHANGES; everything else in the map is.
    meta_keys = {
        "title", "priority", "dueat", "due_at", "slastate", "sla_state",
        "assignedto", "assigned_to",
    }
    changed_tags = [
        key for key in request_tags
        if _text(key).lower() not in meta_keys and _has_value(request_tags.get(key))
    ]
    comment = _text(row.get("new_comment"))
    if comment and comment != "Governance request":
        # new_comment carries a proposed description for description
        # requests; surface that intent with the asset name.
        if asset_short:
            return f"Update description for {asset_short}"
        return "Update description"
    if changed_tags:
        return f"Tag change: {asset_short}" if asset_short else "Tag change"
    if asset_short:
        return f"Governance review: {asset_short}"
    return "Governance request"


def _request_record(row: Mapping[str, Any]) -> Dict[str, Any]:
    raw_request_id = _text(row.get("request_id")) or _text(row.get("requestId"))
    request_id = _customer_safe_text(raw_request_id) if raw_request_id else ""
    request_tags = _mapping_from_json(row.get("new_uc_tags") or row.get("new_uc_tags_json"))
    # Title precedence: explicit column, then new_uc_tags_json (the
    # migration-free stash for fields the table lacks), then the
    # "title: note" convention in new_comment, then a synthesized title
    # from the request's actual change content.
    title = _text(row.get("title")) or _text(request_tags.get("title"))
    if not title:
        comment = _text(row.get("new_comment"))
        title = comment.split(":", 1)[0].strip() if ":" in comment else comment
    note = _text(row.get("detail")) or _text(row.get("new_comment"))
    status = _text(row.get("status")) or "pending"
    asset_fqn = _text(row.get("uc_full_name")) or _text(row.get("assetFqn"))
    if not title or title == "Governance request":
        title = _synthesized_request_title(row, request_tags, asset_fqn)

    created_text = _text(row.get("created_at")) or _text(row.get("createdAt"))
    due_text = (
        _text(row.get("due_at"))
        or _text(row.get("dueAt"))
        or _text(request_tags.get("dueAt") or request_tags.get("due_at"))
    )
    sla_state = (
        _text(row.get("sla_state"))
        or _text(row.get("slaState"))
        or _text(request_tags.get("slaState") or request_tags.get("sla_state"))
    )
    sla_label = ""
    sla_policy = ""
    # Default SLA: when no due date is recorded, derive one from
    # created_at + 7 days and label it honestly as the default policy.
    # Never fabricates when created_at itself is missing.
    if not due_text:
        created_ts = _request_timestamp(created_text)
        if created_ts is not None:
            derived_due = created_ts + dt.timedelta(days=_DEFAULT_SLA_DAYS)
            due_text = derived_due.isoformat()
            sla_policy = "default_7d"
            if not sla_state:
                now = dt.datetime.now(dt.timezone.utc)
                if now > derived_due:
                    sla_state = "overdue"
                elif (derived_due - now) <= dt.timedelta(hours=24):
                    sla_state = "warn"
                else:
                    sla_state = "good"
            sla_label = (
                "Overdue · 7d default SLA"
                if sla_state in {"overdue", "crit", "critical", "breach"}
                else f"Due {derived_due.strftime('%b %-d')} · 7d default SLA"
            )
    return {
        "requestId": request_id,
        "id": request_id,
        "title": title,
        "detail": note,
        "type": _text(row.get("request_type")) or _text(row.get("type")),
        "priority": _text(row.get("priority")) or _text(request_tags.get("priority")),
        "status": status.title(),
        "requester": _text(row.get("created_by")) or _text(row.get("requester")),
        "createdAt": created_text,
        "dueAt": due_text,
        "assetFqn": asset_fqn,
        "domain": _text(row.get("domain")) or _text(request_tags.get("domain")),
        "sla": sla_label,
        "slaPolicy": sla_policy,
        "slaState": sla_state,
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
    selected = (
        _governance_request_detail_from_row(selected_raw, store=store)
        if selected_raw
        else None
    )
    # Overdue: computable now that every request with a created_at carries a
    # (default-policy) due date + slaState from _request_record.
    sla_basis_requests = [record for record in open_requests if _text(record.get("dueAt"))]
    overdue_items = [
        record
        for record in open_requests
        if _lower(record.get("slaState")) in {"overdue", "crit", "critical", "breach"}
    ]
    overdue_metric: Dict[str, Any] = (
        {
            "key": "overdueItems",
            "label": "Overdue Items",
            "value": len(overdue_items),
            "state": "available",
            "reason": (
                "Counted against recorded due dates, falling back to the "
                f"default {_DEFAULT_SLA_DAYS}-day SLA from created_at when no "
                "due date is recorded."
            ),
        }
        if sla_basis_requests
        else {
            "key": "overdueItems",
            "label": "Overdue Items",
            "value": None,
            "state": "unavailable",
            "reason": "No request carries a created_at or due date to evaluate an SLA against.",
        }
    )
    # SLA performance: median resolution time over resolved requests
    # (reviewed_at - created_at). Honest formula, no fabrication.
    resolution_hours: List[float] = []
    for _, record in request_pairs:
        if _lower(record.get("status")) not in {"approved", "rejected", "resolved", "closed"}:
            continue
        created_ts = _request_timestamp(record.get("createdAt"))
        reviewed_ts = _request_timestamp(record.get("reviewedAt"))
        if created_ts is None or reviewed_ts is None or reviewed_ts < created_ts:
            continue
        resolution_hours.append((reviewed_ts - created_ts).total_seconds() / 3600.0)
    if resolution_hours:
        ordered = sorted(resolution_hours)
        mid = len(ordered) // 2
        median_hours = (
            ordered[mid]
            if len(ordered) % 2
            else (ordered[mid - 1] + ordered[mid]) / 2.0
        )
        sla_metric: Dict[str, Any] = {
            "key": "slaPerformance",
            "label": "SLA Performance",
            "value": (
                f"{median_hours:.1f}h median"
                if median_hours < 48
                else f"{median_hours / 24.0:.1f}d median"
            ),
            "medianResolutionHours": round(median_hours, 2),
            "state": "available",
            "reason": (
                "Median of reviewed_at - created_at across "
                f"{len(resolution_hours)} resolved request"
                f"{'' if len(resolution_hours) == 1 else 's'}."
            ),
        }
    else:
        sla_metric = {
            "key": "slaPerformance",
            "label": "SLA Performance",
            "value": None,
            "state": "unavailable",
            "reason": "No resolved requests carry both created_at and reviewed_at yet.",
        }
    payload = {
        "metrics": [
            {"key": "pendingApprovals", "label": "Pending Approvals", "value": len(open_requests)},
            overdue_metric,
            {"key": "policyExceptions", "label": "Policy Exceptions", "value": len(policy_exceptions)},
            sla_metric,
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


def _request_comment_records(
    row: Mapping[str, Any],
    record: Mapping[str, Any],
    store: Any = None,
) -> List[Dict[str, Any]]:
    """Comment timeline for a request from data the store already holds.

    - review_note (written by the workbench Comment/Resolve buttons)
    - audit events that reference this request (metadata_audit_log rows for
      the affected asset whose payload mentions the request id)
    No synthetic entries: if neither source has anything, this is empty.
    """
    comments: List[Dict[str, Any]] = []
    review_note = _text(row.get("review_note"))
    if review_note:
        comments.append({
            "id": f"review-note-{_text(record.get('requestId'))}",
            "author": _text(row.get("reviewed_by")),
            "at": _text(row.get("reviewed_at")),
            "text": review_note,
            "kind": "review-note",
        })
    raw_request_id = _text(row.get("request_id")) or _text(row.get("requestId"))
    asset_fqn = _text(record.get("assetFqn"))
    if store is not None and raw_request_id and asset_fqn:
        for audit_row in _audit_rows(store, limit=100, entity_fqn=asset_fqn):
            if _is_non_authoritative_evidence_row(audit_row):
                continue
            serialized = json.dumps(audit_row, default=str)
            if raw_request_id not in serialized:
                continue
            text = _text(audit_row.get("detail")) or _text(audit_row.get("action"))
            if not text:
                continue
            comments.append({
                "id": _text(audit_row.get("audit_id")) or f"audit-{len(comments)}",
                "author": _text(audit_row.get("actor_email")),
                "at": _text(audit_row.get("created_at")),
                "text": text,
                "kind": "audit",
            })
    comments.sort(key=lambda item: _text(item.get("at")))
    return comments


def _governance_request_detail_from_row(
    row: Mapping[str, Any],
    store: Any = None,
) -> Dict[str, Any] | None:
    row = _row_dict(row)
    if not row:
        return None
    record = _request_record(row)
    after = row.get("new_uc_tags")
    if not isinstance(after, dict):
        after = {}
    if row.get("new_comment"):
        after = {**after, "description": _text(row.get("new_comment"))}
    # `before` stays empty on purpose: filling it would require a per-asset
    # metadata fetch (fan-out) that this composite payload must not do. The
    # client renders after-only rows honestly.
    diff_rows = [
        {"field": key, "label": key.replace("_", " ").title(), "before": "", "after": value}
        for key, value in sorted(after.items())
        if _has_value(value)
    ]
    comments = _request_comment_records(row, record, store=store)
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
        # "unavailable" when empty keeps the honest legacy contract; the
        # timeline flips to available the moment a real review note or
        # request-linked audit event exists.
        "comments": comments,
        "commentsState": "available" if comments else "unavailable",
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
    return _governance_request_detail_from_row(row, store=store)


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


def _is_internal_audit_diff_key(key: Any) -> bool:
    # Mirror of the frontend's isInternalAuditField deny-list: store ids,
    # actor plumbing, and audit timestamps are not customer evidence even when
    # they appear inside before/after JSON payloads.
    normalized = re.sub(r"(?<!^)(?=[A-Z])", "_", _text(key)).lower()
    return bool(
        re.search(
            r"(^|_)(audit_id|entity_id|request_id|entry_id|uc_full_name|identity_key|"
            r"row_hash|created_at|updated_at|created_by|updated_by|actor_email|"
            r"actor_role|actor|timestamp|before_json|after_json|requested_payload_json)(_|$)",
            normalized,
        )
    )


def _customer_safe_audit_diff_value(value: Any, *, depth: int = 0) -> Any:
    """Field-whitelisted copy of a before/after payload: internal keys dropped,
    strings sanitized, size capped so a pathological payload cannot flood the API."""
    if depth > 3:
        return None
    if isinstance(value, Mapping):
        safe: Dict[str, Any] = {}
        for key, item in list(value.items())[:24]:
            if _is_internal_audit_diff_key(key):
                continue
            safe[str(key)] = _customer_safe_audit_diff_value(item, depth=depth + 1)
        return safe
    if isinstance(value, (list, tuple)):
        return [_customer_safe_audit_diff_value(item, depth=depth + 1) for item in list(value)[:8]]
    if isinstance(value, str):
        return _customer_safe_text(value)[:240]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return _customer_safe_text(str(value))[:240]


def _audit_diff_has_content(value: Any) -> bool:
    if isinstance(value, Mapping):
        # Any surviving whitelisted key counts as content — an empty-string
        # value is still a real "field cleared" side of a diff.
        return len(value) > 0
    if isinstance(value, (list, tuple)):
        return len(value) > 0
    if isinstance(value, str):
        return value.strip() != ""
    return value is not None


def _parse_audit_json(value: Any) -> Any:
    if isinstance(value, (Mapping, list, tuple)):
        return value
    text_value = _text(value)
    if not text_value:
        return None
    try:
        return json.loads(text_value)
    except (json.JSONDecodeError, TypeError):
        return text_value


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
    # Before/after JSON is exposed through a field whitelist rather than
    # blanked wholesale: internal store keys and actor plumbing are dropped,
    # and only rows where nothing customer-safe remains stay redacted.
    raw_before = _parse_audit_json(row.get("before_json") or row.get("beforeJson") or row.get("before"))
    raw_after = _parse_audit_json(row.get("after_json") or row.get("afterJson") or row.get("after"))
    safe_before = _customer_safe_audit_diff_value(raw_before)
    safe_after = _customer_safe_audit_diff_value(raw_after)
    for key in ("before_json", "beforeJson", "before", "after_json", "afterJson", "after"):
        if key in safe:
            safe[key] = ""
    def _diff_json(value: Any) -> str:
        if isinstance(value, str):
            return value
        if not _audit_diff_has_content(value):
            return ""
        return json.dumps(value)

    if _audit_diff_has_content(safe_before) or _audit_diff_has_content(safe_after):
        safe["before_json"] = _diff_json(safe_before)
        safe["after_json"] = _diff_json(safe_after)
        safe["diffState"] = "available"
        safe["diffReason"] = ""
    elif raw_before is not None or raw_after is not None:
        safe["diffState"] = "redacted"
        safe["diffReason"] = "Only internal store identifiers changed in this event; no customer-safe metadata fields remain after redaction."
    else:
        safe["diffState"] = "unavailable"
        safe["diffReason"] = "No before/after metadata was recorded for this event."
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
    # Synthesize a display detail from action + target when the row recorded
    # none — a column of rows all reading "No detail recorded" is placeholder
    # spam, not evidence. When there is no target either, leave it empty; the
    # UI suppresses the sub-line instead of repeating a placeholder.
    if not _text(row.get("detail")) and entity_fqn:
        safe["display_detail"] = f"{_event_title(_text(row.get('action')))} for {entity_fqn}"
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


def _cde_last_review(row: Mapping[str, Any]) -> str:
    # A dedicated CDE review log doesn't exist yet, but the inventory row
    # usually carries a real change timestamp (governance-store updated_at or
    # information_schema last_altered). Surfacing that honestly beats the old
    # hardcoded "Unavailable", which made every registry row look dead.
    explicit = _row_tag_text(row, "cde_last_review", "last_review", "lastReview", "reviewed_at", "reviewedAt")
    if explicit:
        return explicit
    return _row_text(row, "updated_at", "updatedAt", "last_altered", "lastAltered", "last_updated", "lastUpdated")


def _recert_window_days(value: Any) -> int | None:
    # Recert windows arrive as free-form tags ("90d", "6m", "1y", "180").
    # Parse conservatively; anything unparseable means "window unknown" so we
    # never fabricate an overdue verdict from a value we didn't understand.
    raw = _lower(value)
    match = re.match(r"^(\d+)\s*(d|day|days|m|mo|month|months|y|yr|year|years)?$", raw)
    if not match:
        return None
    amount = int(match.group(1))
    unit = match.group(2) or "d"
    if unit.startswith("d"):
        return amount
    if unit.startswith("m"):
        return amount * 30
    return amount * 365


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
    last_review = _cde_last_review(row)
    certification_assigned = _lower(certification) not in UNASSIGNED_VALUES
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
        "lastReview": last_review or "Unavailable",
        "lastReviewSource": "asset-metadata" if last_review else "unavailable",
        "recert": recert_window or "Unavailable",
        # Status is the real certification value. Source backing used to be
        # conflated into this field ("Source backed" / "Control evidence
        # unavailable"), which hid the actual certification and read as a fake
        # health verdict. It is now reported separately via sourceBacked /
        # sourceStatus so the UI can render an honest, actionable indicator.
        "status": certification if certification_assigned else "Certification pending",
        "sourceBacked": source_backed,
        "sourceStatus": "tagged" if source_backed else "untagged",
        "recertEvidence": (
            "Review cadence is backed by Unity Catalog CDE registry tags; mutation workflow evidence is unavailable."
            if recert_window
            else "Recertification workflow evidence unavailable."
        ),
        "healthEvidence": (
            "Source-of-record column is backed by Unity Catalog CDE registry tags."
            if source_backed
            else "Tag cde_source_column on the asset to back this CDE with a source-of-record column."
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
    # Overdue reviews: only computable for rows that carry BOTH a parseable
    # recert window and a real last-review timestamp. Rows missing either are
    # excluded rather than guessed at; if no row qualifies the signal stays
    # None so the API can report it as genuinely missing instead of "0".
    now = pd.Timestamp.now(tz="UTC")
    evaluated = 0
    overdue_count = 0
    for item in items:
        window_days = _recert_window_days(item.get("recert"))
        last_review_ts = _timestamp(item.get("lastReview"))
        if window_days is None or last_review_ts is None:
            continue
        evaluated += 1
        if (now - last_review_ts) > pd.Timedelta(days=window_days):
            overdue_count += 1
    return {
        "summary": {
            "totalCdes": len(items),
            # Protected = sensitivity assigned and stronger than "internal" —
            # the same population the sensitiveCandidates signal counts. This
            # was previously hardcoded to None, which forced the route into a
            # permanent degraded state.
            "protectedCdes": len(protected),
            "sensitiveCandidates": len(protected),
            "overdueReviews": overdue_count if evaluated else None,
            "reviewsEvaluated": evaluated,
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
    # 90d was silently falling through to "all time", so the widest range in
    # the UI applied no filter at all while claiming a 90-day scope.
    if value in {"90d", "3m"}:
        return pd.Timedelta(days=90)
    return None


def _filter_audit_rows_by_range(rows: Sequence[Mapping[str, Any]], date_range: str | None) -> List[Dict[str, Any]]:
    window = _audit_window_start(date_range)
    if window is None:
        return [dict(row) for row in rows]
    # Timestamp.utcnow() is deprecated in pandas 4; now(tz=...) is equivalent.
    now = pd.Timestamp.now(tz="UTC")
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


def _audit_evidence_rows(store: Any, *, limit: int) -> List[Dict[str, Any]]:
    # Prefer the SQL-side internal-action exclusion so LIMIT applies to
    # customer-visible rows (identity-directory bookkeeping rows can dominate
    # the newest N and starve the feed). Stores without the parameter fall
    # back to the shared unfiltered fetch; the Python-side visibility filter
    # below still guarantees correctness either way.
    rows = _call_store(store, "list_metadata_audit", limit=limit, exclude_internal=True)
    if rows is not None:
        return _records(rows, limit=limit)
    return _audit_rows(store, limit=limit)


def _audit_last_event_at(rows: Sequence[Mapping[str, Any]]) -> str:
    newest: pd.Timestamp | None = None
    for row in rows:
        timestamp = _timestamp(row.get("created_at") or row.get("createdAt") or row.get("updated_at") or row.get("updatedAt"))
        if timestamp is not None and (newest is None or timestamp > newest):
            newest = timestamp
    return newest.isoformat() if newest is not None else ""


def _is_policy_violation_audit_row(row: Mapping[str, Any]) -> bool:
    action = _lower(row.get("action"))
    if "policy-exception-detected" in action or "policy_exception_detected" in action:
        return True
    haystack = f"{action} {_lower(row.get('detail'))} {_lower(row.get('status'))}"
    return "policy" in haystack and bool(
        re.search(r"violation|exception|breach|denied|failed", haystack)
    )


def _audit_access_review_summary(store: Any) -> Dict[str, Any]:
    """Back the 'Access reviews · open' KPI with real change-request state
    instead of a text match on 'approv' in audit rows."""
    request_rows, available, reason = _store_records(store, "list_change_requests", limit=500)
    if not available:
        return {"open": None, "resolved": None, "reason": reason or "Change-request source unavailable."}
    trusted = [row for row in request_rows if not _is_non_authoritative_evidence_row(row)]
    open_statuses = {"", "pending", "open", "new", "in review", "in_review"}
    resolved_statuses = {"approved", "rejected", "closed", "resolved", "cancelled", "canceled"}
    open_count = sum(1 for row in trusted if _lower(row.get("status")) in open_statuses)
    resolved_count = sum(1 for row in trusted if _lower(row.get("status")) in resolved_statuses)
    return {"open": open_count, "resolved": resolved_count, "reason": ""}


def _audit_source_table(store: Any) -> str:
    # Real provenance for the footer: the governed Delta table the evidence is
    # read from, not an internal source slug.
    catalog = _text(getattr(store, "catalog", ""))
    schema = _text(getattr(store, "schema", ""))
    if catalog and schema:
        return f"{catalog}.{schema}.metadata_audit_log"
    return ""


AUDIT_EVIDENCE_DEFAULT_LIMIT = 500


def audit_evidence_payload(
    *,
    store: Any,
    audit_id: str | None = None,
    date_range: str | None = None,
    # 500, not 200: visibility scoping legitimately withholds rows about
    # assets outside the actor's scope, so a small fetch window starves the
    # surviving feed of older updated/status events.
    limit: int = AUDIT_EVIDENCE_DEFAULT_LIMIT,
    visible_asset_fqns: Sequence[str] | None = None,
) -> Dict[str, Any]:
    fetched = _audit_evidence_rows(store, limit=limit)
    ranged_audit = _filter_audit_rows_by_range(fetched, date_range)
    scoped_audit = _filter_audit_rows_by_visible_assets(ranged_audit, visible_asset_fqns)
    audit = [row for row in scoped_audit if _is_customer_visible_audit_row(row)]
    # Newest customer-visible event regardless of the selected range, so an
    # empty 24h window can point the user at where the activity actually is.
    visible_any_range = [
        row
        for row in _filter_audit_rows_by_visible_assets(fetched, visible_asset_fqns)
        if _is_customer_visible_audit_row(row)
    ]
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
    policy_violations = [row for row in audit if _is_policy_violation_audit_row(row)]
    access_reviews = _audit_access_review_summary(store)
    return {
        "summary": {
            "totalChanges": len(audit),
            "dateRange": _text(date_range),
            "policyChanges": len(policy),
            "policyViolations": len(policy_violations),
            "approvals": len(approvals),
            "accessReviewsOpen": access_reviews["open"],
            "reviewsResolved": access_reviews["resolved"],
            "accessReviewSource": (
                "governance change requests" if access_reviews["open"] is not None else access_reviews["reason"]
            ),
            "failedActions": len(failed),
            "lastEventAt": _audit_last_event_at(visible_any_range),
            "summarySource": "governance audit log",
            "sourceTable": _audit_source_table(store),
            "rowScope": "visible-assets" if visible_asset_fqns is not None else "governance audit log",
            "hiddenRowsExcluded": max(0, len(ranged_audit) - len(audit)),
            # Split the exclusion so the UI can say WHY rows were withheld:
            # visibility scoping (row-level security on assets outside the
            # actor's scope) is a different story than internal bookkeeping.
            "visibilityScopedRowsExcluded": max(0, len(ranged_audit) - len(scoped_audit)),
            "internalRowsExcluded": max(0, len(scoped_audit) - len(audit)),
        },
        "events": safe_audit,
        "selectedEvent": selected,
        "evidence": {
            "before": selected.get("before_json") or "",
            "after": selected.get("after_json") or "",
            "diffState": selected.get("diffState") if selected else "unavailable",
            "diffReason": selected.get("diffReason") if selected else "No selected audit event.",
            "approvalChain": [],
            "artifacts": [],
            "linkedRequest": selected.get("request_id") if selected else "",
        }
        if selected
        else None,
    }


def _admin_internal_audit_row(row: Mapping[str, Any]) -> bool:
    """True for internal bookkeeping audit rows (identity mirroring etc.).

    Live audit actions arrive hyphenated ("identity-directory-upserted");
    the shared _INTERNAL_EVENT_TOKENS list is underscore/space-form, so
    _recent_events' own substring check never matched them and the admin
    activity feed rendered 100% internal noise. Normalize separators here
    before matching.
    """
    action = _lower(row.get("action")).replace("-", "_").replace(" ", "_")
    return any(token.replace(" ", "_") in action for token in _INTERNAL_EVENT_TOKENS)


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
    by_domain = []
    for row in command.get("posture", {}).get("byDomain", [])[:5]:
        if not isinstance(row, Mapping):
            continue
        metadata_coverage = row.get("score", row.get("value"))
        by_domain.append(
            {
                "domain": _text(row.get("domain") or row.get("label")) or "Unassigned",
                "required": None,
                "enforced": None,
                # `coverage` is METADATA coverage (backed by visible-asset
                # diagnostics), not policy-enforcement coverage — there is no
                # policy library/enforcement source yet. Surfacing the real
                # per-domain number (with coverageKind so the UI can label it
                # honestly) replaces the previous hard-coded None that forced
                # the Control Center to render five disabled "Unavailable"
                # rows despite real data sitting in metadataCoverage.
                "coverage": metadata_coverage,
                "coverageKind": "metadata",
                "trend": [],
                "state": "available" if metadata_coverage is not None else "unavailable",
                "metadataCoverage": metadata_coverage,
                "assetCount": row.get("assetCount"),
                "reason": (
                    "Metadata coverage from visible-asset diagnostics; policy-enforcement coverage is not yet backed."
                    if metadata_coverage is not None
                    else unavailable_reason
                ),
            }
        )
    # NOTE: the all-null `compliance` block that used to live here was
    # pruned — nothing in the frontend or tests consumed it, and emitting
    # a permanently-null structure invites the UI to render fake rows.
    return {
        "cards": cards,
        "byDomain": by_domain,
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
    runtime: Mapping[str, Any] | None = None,
    jobs: Sequence[Mapping[str, Any]] | None = None,
) -> List[Dict[str, Any]]:
    ai_state = _text(ai_status.get("state") if ai_status else "") or "unavailable"
    # SQL Warehouse state comes from the live runtime diagnostics: the app is
    # bound to a warehouse (client.warehouseId) and runtime.state says whether
    # the SQL client is actually serving queries. Reporting this as a real row
    # (instead of leaving the frontend to render a fabricated "Unavailable"
    # slot) is what makes the Integrations panel trustworthy.
    runtime = runtime if isinstance(runtime, Mapping) else {}
    client = runtime.get("client") if isinstance(runtime.get("client"), Mapping) else {}
    warehouse_id = _text(client.get("warehouseId"))
    runtime_state = _lower(runtime.get("state"))
    warehouse_live = runtime_state == "live" and bool(warehouse_id)
    job_rows = [row for row in (jobs or []) if isinstance(row, Mapping)]
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
        # New rows are appended (not inserted) so existing consumers that
        # address integrations by index keep working.
        {
            "key": "sqlWarehouse",
            "label": "Databricks SQL Warehouse",
            "subtitle": (
                f"Warehouse {warehouse_id}" if warehouse_id else "No warehouse binding reported"
            ),
            "state": "connected" if warehouse_live else (runtime_state or "unavailable"),
            "health": "Healthy" if warehouse_live else "Unavailable",
            **(
                {}
                if warehouse_live
                else {"reason": "Runtime diagnostics did not report a live SQL warehouse binding."}
            ),
        },
        {
            "key": "lakeflowJobs",
            "label": "Lakeflow Jobs",
            "subtitle": (
                f"{len(job_rows)} job{'s' if len(job_rows) != 1 else ''} in workspace inventory"
                if job_rows
                else "Jobs API returned no rows"
            ),
            "state": "connected" if job_rows else "unavailable",
            "health": "Healthy" if job_rows else "Unavailable",
            **(
                {}
                if job_rows
                else {"reason": "The Databricks Jobs API returned no scheduled-job rows for the app principal."}
            ),
        },
        # Deliberately NO "Model Serving" / "Incident management" rows: no
        # runtime probe backs those products, and emitting permanent
        # "Unavailable" placeholders for aspirational integrations destroys
        # trust in the rows that ARE real.
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
    # Fetch a deep audit window: _recent_events drops internal bookkeeping
    # rows (identity_directory/entity_registry/alias/notification/projection/
    # mirror upserts), and with only 10 raw rows the whole activity feed was
    # routinely 100% internal noise — leaving zero real governance events.
    audit = _audit_rows(store, limit=50)
    # Pre-filter with separator-normalized matching (see
    # _admin_internal_audit_row): live actions are hyphenated and slip past
    # _recent_events' underscore-form token check.
    governance_audit = [row for row in audit if not _admin_internal_audit_row(row)]
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
            runtime=runtime,
            jobs=jobs,
        ),
        "access": _admin_access_summary(store),
        "runtimeSummary": _admin_runtime_summary(runtime, ai_status=ai_status),
        "system": _admin_runtime_summary(runtime, ai_status=ai_status),
        "recentAdminActivity": _recent_events(governance_audit, limit=10),
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
