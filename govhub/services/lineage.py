from __future__ import annotations

import time
from typing import Any, Callable, Dict, List, Optional, Tuple

import pandas as pd

import app as legacy_streamlit
from govhub.uc import UCSQLClient

from govhub.services import assets as asset_service


def _raw(fn: Callable[..., Any]) -> Callable[..., Any]:
    return getattr(fn, "__wrapped__", fn)


_cached_lineage_up = _raw(legacy_streamlit._cached_lineage_up)
_cached_lineage_down = _raw(legacy_streamlit._cached_lineage_down)
_cached_operational_context_up = _raw(legacy_streamlit._cached_operational_context_up)
_cached_operational_context_down = _raw(legacy_streamlit._cached_operational_context_down)

enrich_operational_context_names = legacy_streamlit._enrich_operational_context_names
summarize_operational_context = legacy_streamlit._summarize_operational_context


_TTL_CACHE: Dict[str, Tuple[float, Any]] = {}


def _ttl_value(key: str, ttl_s: int, loader: Callable[[], Any]) -> Any:
    now = time.time()
    cached = _TTL_CACHE.get(key)
    if cached and now - cached[0] < ttl_s:
        return cached[1]
    value = loader()
    _TTL_CACHE[key] = (now, value)
    return value


def _warehouse_key(uc: UCSQLClient) -> str:
    return asset_service.normalize_str(getattr(uc, "warehouse_id", "")) or "default"


def invalidate_lineage_caches(asset_fqn: str | None = None) -> None:
    if asset_fqn is None:
        _TTL_CACHE.clear()
        return
    suffix = f":{asset_service.normalize_str(asset_fqn)}"
    for key in list(_TTL_CACHE):
        if key.endswith(suffix) and key.startswith("lineage:"):
            _TTL_CACHE.pop(key, None)


def graph_node_for_asset(
    uc: UCSQLClient,
    store: Any,
    asset_fqn: str,
    role: str,
    x: int,
    y: int,
    *,
    kicker: str,
    kind: str = "",
    foot: Optional[List[str]] = None,
    depth: int = 1,
) -> Dict[str, Any]:
    row = asset_service.inventory_row(uc, store, asset_fqn)
    label = asset_service.normalize_str(row.get("table_name")) or asset_fqn.split(".")[-1]
    subtitle = " / ".join(
        part
        for part in [
            asset_service.normalize_str(row.get("table_catalog")),
            asset_service.normalize_str(row.get("table_schema")),
        ]
        if part
    )
    item_kind = kind or asset_service.friendly_table_type(
        row.get("table_type"),
        row.get("data_source_format"),
    )
    footer = foot or [item_kind]
    return {
        "id": f"{role}-{asset_fqn}",
        "assetFqn": asset_fqn,
        "label": label,
        "subtitle": subtitle,
        "kicker": kicker,
        "kind": item_kind,
        "role": role,
        "depth": depth,
        "x": x,
        "y": y,
        "foot": footer,
    }


def stack_positions(
    count: int,
    *,
    x: int,
    top: int = 22,
    bottom: int = 78,
) -> List[Tuple[int, int]]:
    if count <= 0:
        return []
    if count == 1:
        return [(x, 50)]
    span = max(bottom - top, 10)
    step = span / (count - 1)
    return [(x, round(top + idx * step)) for idx in range(count)]


def build_data_graph(uc: UCSQLClient, store: Any, asset_fqn: str) -> Dict[str, Any]:
    row = asset_service.inventory_row(uc, store, asset_fqn)
    catalog, schema, table = asset_service.split_uc_name(
        asset_service.normalize_str(row.get("fqn"))
    )
    focus = graph_node_for_asset(
        uc,
        store,
        asset_fqn,
        "focus",
        50,
        50,
        kicker="Focus",
        kind=asset_service.friendly_table_type(
            row.get("table_type"),
            row.get("data_source_format"),
        ),
        foot=[asset_service.normalize_str(row.get("certification")) or "Unassigned"],
        depth=0,
    )
    try:
        upstream_df = asset_service.filter_asset_rows(
            _cached_lineage_up(uc, catalog, schema, table),
            ["source_table_name", "source_table_full_name"],
            exclude_fqn=asset_fqn,
        )
    except Exception:
        upstream_df = pd.DataFrame()
    try:
        downstream_df = asset_service.filter_asset_rows(
            _cached_lineage_down(uc, catalog, schema, table),
            ["target_table_name", "target_table_full_name"],
            exclude_fqn=asset_fqn,
        )
    except Exception:
        downstream_df = pd.DataFrame()
    upstream_assets = (
        upstream_df["source_table_full_name"].dropna().astype(str).tolist()
        if (
            upstream_df is not None
            and not upstream_df.empty
            and "source_table_full_name" in upstream_df.columns
        )
        else []
    )
    downstream_assets = (
        downstream_df["target_table_full_name"].dropna().astype(str).tolist()
        if (
            downstream_df is not None
            and not downstream_df.empty
            and "target_table_full_name" in downstream_df.columns
        )
        else []
    )

    nodes = [focus]
    edges: List[Dict[str, Any]] = []
    for idx, (x, y) in enumerate(stack_positions(len(upstream_assets), x=20)):
        upstream_fqn = asset_service.normalize_str(upstream_assets[idx])
        node = graph_node_for_asset(uc, store, upstream_fqn, "source", x, y, kicker="Source")
        nodes.append(node)
        edges.append({"source": node["id"], "target": focus["id"], "depth": 1})
    for idx, (x, y) in enumerate(stack_positions(len(downstream_assets), x=80)):
        downstream_fqn = asset_service.normalize_str(downstream_assets[idx])
        node = graph_node_for_asset(uc, store, downstream_fqn, "target", x, y, kicker="Target")
        nodes.append(node)
        edges.append({"source": focus["id"], "target": node["id"], "depth": 1})

    if len(nodes) == 1:
        return {"nodes": [focus], "edges": []}
    return {"nodes": nodes, "edges": edges}


def build_operational_graph(uc: UCSQLClient, store: Any, asset_fqn: str) -> Dict[str, Any]:
    row = asset_service.inventory_row(uc, store, asset_fqn)
    catalog, schema, table = asset_service.split_uc_name(
        asset_service.normalize_str(row.get("fqn"))
    )
    focus = graph_node_for_asset(
        uc,
        store,
        asset_fqn,
        "focus",
        50,
        48,
        kicker="Focus",
        kind=asset_service.friendly_table_type(
            row.get("table_type"),
            row.get("data_source_format"),
        ),
        foot=["Operational center"],
        depth=0,
    )
    try:
        upstream_df = enrich_operational_context_names(
            uc,
            _cached_operational_context_up(uc, catalog, schema, table),
        )
    except Exception:
        upstream_df = pd.DataFrame()
    try:
        downstream_df = enrich_operational_context_names(
            uc,
            _cached_operational_context_down(uc, catalog, schema, table),
        )
    except Exception:
        downstream_df = pd.DataFrame()
    upstream_cards = summarize_operational_context(
        upstream_df,
        direction="upstream",
        focus_asset_name=focus["label"],
    )
    downstream_cards = summarize_operational_context(
        downstream_df,
        direction="downstream",
        focus_asset_name=focus["label"],
    )

    nodes = [focus]
    edges: List[Dict[str, Any]] = []

    for idx, (x, y) in enumerate(stack_positions(len(upstream_cards), x=21)):
        card = upstream_cards[idx]
        node = {
            "id": f"op-up-{idx + 1}",
            "label": card["title"],
            "subtitle": card["subtitle"] or card["note"],
            "kicker": card["entity_label"],
            "kind": card["entity_label"],
            "role": "source",
            "depth": 1,
            "x": x,
            "y": y,
            "foot": [f"{card['asset_count']} {card['assets_label']}"],
        }
        nodes.append(node)
        edges.append({"source": node["id"], "target": focus["id"], "depth": 1})

    for idx, (x, y) in enumerate(stack_positions(len(downstream_cards), x=79)):
        card = downstream_cards[idx]
        node = {
            "id": f"op-down-{idx + 1}",
            "label": card["title"],
            "subtitle": card["subtitle"] or card["note"],
            "kicker": card["entity_label"],
            "kind": card["entity_label"],
            "role": "target",
            "depth": 1,
            "x": x,
            "y": y,
            "foot": [f"{card['asset_count']} {card['assets_label']}"],
        }
        nodes.append(node)
        edges.append({"source": focus["id"], "target": node["id"], "depth": 1})

    return {"nodes": nodes, "edges": edges}


def lineage_payload(uc: UCSQLClient, store: Any, asset_fqn: str) -> Dict[str, Any]:
    return _ttl_value(
        f"lineage:{_warehouse_key(uc)}:{asset_service.normalize_str(asset_fqn)}",
        300,
        lambda: {
            "fqn": asset_fqn,
            "graphs": {
                "data": build_data_graph(uc, store, asset_fqn),
                "operational": build_operational_graph(uc, store, asset_fqn),
            },
        },
    )
