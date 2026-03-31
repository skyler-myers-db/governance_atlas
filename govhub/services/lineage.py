from __future__ import annotations

import time
from typing import Any, Callable, Dict, List, Optional, Tuple

import pandas as pd

from govhub.uc import UCSQLClient

from govhub.services import assets as asset_service
from govhub.services import live_metadata as metadata_service


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
        "details": {
            "fqn": asset_fqn,
            "description": asset_service.normalize_str(row.get("comment"))
            or asset_service.PLACEHOLDER_DESCRIPTION,
            "governanceStatus": asset_service.normalize_str(row.get("governance_status"))
            or "Needs Work",
            "domain": asset_service.normalize_str(row.get("domain")) or "Unassigned",
            "tier": asset_service.normalize_str(row.get("tier")) or "Unassigned",
            "certification": asset_service.normalize_str(row.get("certification")) or "Unassigned",
            "sensitivity": asset_service.normalize_str(row.get("sensitivity")) or "Unassigned",
        },
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


def _data_edge_key(source_id: str, target_id: str) -> str:
    return f"data:{source_id}->{target_id}"


def _operational_edge_key(source_id: str, target_id: str) -> str:
    return f"operational:{source_id}->{target_id}"


def _column_lineage_payload(uc: UCSQLClient, asset_fqn: str) -> Dict[str, List[Dict[str, Any]]]:
    catalog, schema, table = asset_service.split_uc_name(asset_fqn)
    try:
        upstream_df = uc.get_column_lineage_upstream(catalog, schema, table)
    except Exception:
        upstream_df = pd.DataFrame()
    try:
        downstream_df = uc.get_column_lineage_downstream(catalog, schema, table)
    except Exception:
        downstream_df = pd.DataFrame()

    upstream: Dict[str, List[Dict[str, str]]] = {}
    if upstream_df is not None and not upstream_df.empty:
        for _, row in upstream_df.iterrows():
            target_column = asset_service.normalize_str(row.get("target_column_name"))
            source_asset = asset_service.normalize_str(row.get("source_table_full_name"))
            source_column = asset_service.normalize_str(row.get("source_column_name"))
            if not target_column or not source_asset or not source_column:
                continue
            upstream.setdefault(target_column, []).append(
                {"assetFqn": source_asset, "column": source_column}
            )

    downstream: Dict[str, List[Dict[str, str]]] = {}
    if downstream_df is not None and not downstream_df.empty:
        for _, row in downstream_df.iterrows():
            source_column = asset_service.normalize_str(row.get("source_column_name"))
            target_asset = asset_service.normalize_str(row.get("target_table_full_name"))
            target_column = asset_service.normalize_str(row.get("target_column_name"))
            if not source_column or not target_asset or not target_column:
                continue
            downstream.setdefault(source_column, []).append(
                {"assetFqn": target_asset, "column": target_column}
            )

    return {
        "upstream": [
            {"column": column, "sources": sources}
            for column, sources in sorted(upstream.items())
        ],
        "downstream": [
            {"column": column, "targets": targets}
            for column, targets in sorted(downstream.items())
        ],
    }


def _data_edge_details(
    graph: Dict[str, Any],
    column_lineage: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, Dict[str, Any]]:
    focus_node = next((node for node in graph.get("nodes", []) if node.get("role") == "focus"), None)
    focus_fqn = asset_service.normalize_str(focus_node.get("assetFqn")) if focus_node else ""
    upstream_lookup: Dict[str, List[Dict[str, str]]] = {}
    for entry in column_lineage.get("upstream", []):
        target_column = asset_service.normalize_str(entry.get("column"))
        for source in entry.get("sources", []) or []:
            source_fqn = asset_service.normalize_str(source.get("assetFqn"))
            if not source_fqn or not target_column:
                continue
            upstream_lookup.setdefault(source_fqn, []).append(
                {
                    "sourceColumn": asset_service.normalize_str(source.get("column")),
                    "targetColumn": target_column,
                }
            )
    downstream_lookup: Dict[str, List[Dict[str, str]]] = {}
    for entry in column_lineage.get("downstream", []):
        source_column = asset_service.normalize_str(entry.get("column"))
        for target in entry.get("targets", []) or []:
            target_fqn = asset_service.normalize_str(target.get("assetFqn"))
            if not target_fqn or not source_column:
                continue
            downstream_lookup.setdefault(target_fqn, []).append(
                {
                    "sourceColumn": source_column,
                    "targetColumn": asset_service.normalize_str(target.get("column")),
                }
            )

    details: Dict[str, Dict[str, Any]] = {}
    for edge in graph.get("edges", []) or []:
        source_id = edge.get("source")
        target_id = edge.get("target")
        source_node = next((node for node in graph.get("nodes", []) if node.get("id") == source_id), {})
        target_node = next((node for node in graph.get("nodes", []) if node.get("id") == target_id), {})
        key = edge.get("key") or _data_edge_key(source_id, target_id)
        source_fqn = asset_service.normalize_str(source_node.get("assetFqn"))
        target_fqn = asset_service.normalize_str(target_node.get("assetFqn"))
        mappings = []
        if target_fqn == focus_fqn:
            mappings = upstream_lookup.get(source_fqn, [])
        elif source_fqn == focus_fqn:
            mappings = downstream_lookup.get(target_fqn, [])
        details[key] = {
            "kind": "data",
            "sourceAssetFqn": source_fqn,
            "targetAssetFqn": target_fqn,
            "mappingCount": len(mappings),
            "columnMappings": mappings[:20],
            "summary": (
                f"{len(mappings)} column mapping{'s' if len(mappings) != 1 else ''}"
                if mappings
                else "Table-level lineage relationship"
            ),
        }
    return details


def _operational_edge_details(graph: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    details: Dict[str, Dict[str, Any]] = {}
    node_lookup = {node.get("id"): node for node in graph.get("nodes", [])}
    for edge in graph.get("edges", []) or []:
        source_node = node_lookup.get(edge.get("source"), {})
        target_node = node_lookup.get(edge.get("target"), {})
        key = edge.get("key") or _operational_edge_key(edge.get("source", ""), edge.get("target", ""))
        payload_node = source_node if source_node.get("role") != "focus" else target_node
        details[key] = {
            "kind": "operational",
            "summary": asset_service.normalize_str(payload_node.get("subtitle")) or "Operational context relationship",
            "entities": payload_node.get("details", []) or [],
        }
    return details


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
            metadata_service.cached_lineage_up(uc, catalog, schema, table),
            ["source_table_name", "source_table_full_name"],
            exclude_fqn=asset_fqn,
        )
    except Exception:
        upstream_df = pd.DataFrame()
    try:
        downstream_df = asset_service.filter_asset_rows(
            metadata_service.cached_lineage_down(uc, catalog, schema, table),
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
        edges.append(
            {
                "source": node["id"],
                "target": focus["id"],
                "depth": 1,
                "key": _data_edge_key(node["id"], focus["id"]),
            }
        )
    for idx, (x, y) in enumerate(stack_positions(len(downstream_assets), x=80)):
        downstream_fqn = asset_service.normalize_str(downstream_assets[idx])
        node = graph_node_for_asset(uc, store, downstream_fqn, "target", x, y, kicker="Target")
        nodes.append(node)
        edges.append(
            {
                "source": focus["id"],
                "target": node["id"],
                "depth": 1,
                "key": _data_edge_key(focus["id"], node["id"]),
            }
        )

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
        upstream_df = metadata_service.enrich_operational_context_names(
            uc,
            metadata_service.cached_operational_context_up(uc, catalog, schema, table),
        )
    except Exception:
        upstream_df = pd.DataFrame()
    try:
        downstream_df = metadata_service.enrich_operational_context_names(
            uc,
            metadata_service.cached_operational_context_down(uc, catalog, schema, table),
        )
    except Exception:
        downstream_df = pd.DataFrame()
    upstream_entities = asset_service.operational_entity_records(uc, upstream_df)
    downstream_entities = asset_service.operational_entity_records(uc, downstream_df)

    nodes = [focus]
    edges: List[Dict[str, Any]] = []

    for idx, (x, y) in enumerate(stack_positions(len(upstream_entities), x=21)):
        entity = upstream_entities[idx]
        node = {
            "id": f"op-up-{idx + 1}",
            "label": entity["name"],
            "subtitle": entity.get("statementId") or entity.get("entityId") or "Operational producer",
            "kicker": entity["entityLabel"],
            "kind": entity["entityLabel"],
            "role": "source",
            "depth": 1,
            "x": x,
            "y": y,
            "foot": [f"{len(entity.get('relatedAssets', []))} related asset(s)"],
            "details": [entity],
        }
        nodes.append(node)
        edges.append(
            {
                "source": node["id"],
                "target": focus["id"],
                "depth": 1,
                "key": _operational_edge_key(node["id"], focus["id"]),
            }
        )

    for idx, (x, y) in enumerate(stack_positions(len(downstream_entities), x=79)):
        entity = downstream_entities[idx]
        node = {
            "id": f"op-down-{idx + 1}",
            "label": entity["name"],
            "subtitle": entity.get("statementId") or entity.get("entityId") or "Operational consumer",
            "kicker": entity["entityLabel"],
            "kind": entity["entityLabel"],
            "role": "target",
            "depth": 1,
            "x": x,
            "y": y,
            "foot": [f"{len(entity.get('relatedAssets', []))} related asset(s)"],
            "details": [entity],
        }
        nodes.append(node)
        edges.append(
            {
                "source": focus["id"],
                "target": node["id"],
                "depth": 1,
                "key": _operational_edge_key(focus["id"], node["id"]),
            }
        )

    return {"nodes": nodes, "edges": edges}


def lineage_payload(uc: UCSQLClient, store: Any, asset_fqn: str) -> Dict[str, Any]:
    return _ttl_value(
        f"lineage:{_warehouse_key(uc)}:{asset_service.normalize_str(asset_fqn)}",
        300,
        lambda: _build_lineage_payload(uc, store, asset_fqn),
    )


def _build_lineage_payload(uc: UCSQLClient, store: Any, asset_fqn: str) -> Dict[str, Any]:
    data_graph = build_data_graph(uc, store, asset_fqn)
    operational_graph = build_operational_graph(uc, store, asset_fqn)
    column_lineage = _column_lineage_payload(uc, asset_fqn)
    data_edge_details = _data_edge_details(data_graph, column_lineage)
    operational_edge_details = _operational_edge_details(operational_graph)
    data_focus_id = next(
        (node.get("id") for node in data_graph.get("nodes", []) if node.get("role") == "focus"),
        "",
    )

    return {
        "fqn": asset_fqn,
        "graphs": {
            "data": data_graph,
            "operational": operational_graph,
        },
        "columnLineage": column_lineage,
        "edgeDetails": {
            **data_edge_details,
            **operational_edge_details,
        },
        "stats": {
            "upstreamCount": sum(
                1 for edge in data_graph.get("edges", []) if edge.get("target") == data_focus_id
            ),
            "downstreamCount": sum(
                1 for edge in data_graph.get("edges", []) if edge.get("source") == data_focus_id
            ),
            "operationalProducerCount": sum(
                1 for node in operational_graph.get("nodes", []) if node.get("role") == "source"
            ),
            "operationalConsumerCount": sum(
                1 for node in operational_graph.get("nodes", []) if node.get("role") == "target"
            ),
        },
    }
