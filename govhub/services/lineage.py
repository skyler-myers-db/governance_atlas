from __future__ import annotations

import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Deque, Dict, List, Optional, Set, Tuple

import pandas as pd

from govhub.uc import UCSQLClient

from govhub.services import assets as asset_service
from govhub.services import live_metadata as metadata_service


_TTL_CACHE: Dict[str, Tuple[float, Any]] = {}
# Per-key locks serialize concurrent loaders so a burst of 8 parallel
# requests for the same lineage asset turns into one SQL round-trip, not
# eight. The outer dict is guarded by _TTL_CACHE_LOCKS_GUARD so lock
# creation is itself thread-safe.
_TTL_CACHE_LOCKS: Dict[str, threading.Lock] = {}
_TTL_CACHE_LOCKS_GUARD = threading.Lock()


def _ttl_cache_lock(key: str) -> threading.Lock:
    existing = _TTL_CACHE_LOCKS.get(key)
    if existing is not None:
        return existing
    with _TTL_CACHE_LOCKS_GUARD:
        existing = _TTL_CACHE_LOCKS.get(key)
        if existing is None:
            existing = threading.Lock()
            _TTL_CACHE_LOCKS[key] = existing
        return existing
TABLE_LINEAGE_LIMIT = 50
COLUMN_LINEAGE_LIMIT = 500
OPERATIONAL_CONTEXT_LIMIT = 200
SECOND_HOP_SEED_LIMIT = 6
SECOND_HOP_NEIGHBOR_LIMIT = 25
SECOND_HOP_SAMPLE_LIMIT = 8
LINEAGE_GRAPH_DEPTH_LIMIT = 4
LINEAGE_GRAPH_NODE_LIMIT = 72
LINEAGE_GRAPH_PER_HOP_LIMIT = 24


def _ttl_value(key: str, ttl_s: int, loader: Callable[[], Any]) -> Any:
    now = time.time()
    cached = _TTL_CACHE.get(key)
    if cached and now - cached[0] < ttl_s:
        return cached[1]
    lock = _ttl_cache_lock(key)
    with lock:
        cached = _TTL_CACHE.get(key)
        if cached and time.time() - cached[0] < ttl_s:
            return cached[1]
        value = loader()
        _TTL_CACHE[key] = (time.time(), value)
        return value


def _warehouse_key(uc: UCSQLClient) -> str:
    return asset_service.normalize_str(getattr(uc, "warehouse_id", "")) or "default"


def _cache_scope_key(cache_scope: str = "") -> str:
    return asset_service.normalize_str(cache_scope) or "shared"


def invalidate_lineage_caches(asset_fqn: str | None = None) -> None:
    if asset_fqn is None:
        _TTL_CACHE.clear()
        return
    suffix = f":{asset_service.normalize_str(asset_fqn)}"
    for key in list(_TTL_CACHE):
        if key.endswith(suffix) and key.startswith("lineage:"):
            _TTL_CACHE.pop(key, None)


FOCUS_COLUMN_PREVIEW_LIMIT = 20


def _focus_columns_payload(
    uc: UCSQLClient,
    asset_fqn: str,
    *,
    limit: int = FOCUS_COLUMN_PREVIEW_LIMIT,
) -> List[Dict[str, Any]]:
    """Return a compact column-preview list for the focus node.

    Defect 6 + 8 — the lineage payload previously omitted `columns` on
    every node, which meant the front-end's "Include Columns" toggle had
    nothing to surface on the focused card and the Details tab could not
    render a schema preview. We fetch the column list via the cached
    `uc.get_table_columns` path (same source the entity workspace uses),
    clamp to `limit` rows to keep the payload cheap, and emit the minimal
    shape the UI expects (`name`, `type`, optional `qualityTone`).

    Any failure is swallowed silently — missing columns degrade the
    focus card gracefully (it falls back to the non-column layout) but
    must never break the lineage graph itself.
    """
    try:
        catalog, schema, table = asset_service.split_uc_name(asset_fqn)
    except ValueError:
        return []
    try:
        columns_df = uc.get_table_columns(catalog, schema, table)
    except Exception:
        return []
    if columns_df is None or columns_df.empty:
        return []
    rows: List[Dict[str, Any]] = []
    for _, row in columns_df.head(limit).iterrows():
        name = asset_service.normalize_str(row.get("column_name"))
        if not name:
            continue
        rows.append(
            {
                "name": name,
                "type": asset_service.normalize_str(row.get("data_type")),
            }
        )
    return rows


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
    visible_inventory: Optional[pd.DataFrame] = None,
    include_columns: bool = False,
) -> Dict[str, Any]:
    row = asset_service.inventory_row(uc, store, asset_fqn)
    identity_resolved = bool(asset_service.normalize_str(row.get("table_type")))
    visible_inventory_df = (
        visible_inventory
        if isinstance(visible_inventory, pd.DataFrame)
        else asset_service.visible_assets(uc, store)
    )
    is_openable = asset_service.asset_is_visible(visible_inventory_df, asset_fqn)
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
    if not identity_resolved and not item_kind:
        item_kind = "Lineage Reference"
    footer = foot or [item_kind]
    if not is_openable and "Metadata record unavailable" not in footer:
        footer = [*footer, "Metadata record unavailable"]
    # Defect 6 + 8 — only the focus node receives a column preview so the
    # payload stays cheap (non-focus nodes render as compact icon + name
    # cards per round-18 design). `include_columns=False` skips the
    # column fetch entirely so this helper stays cheap for peer nodes.
    columns_payload = (
        _focus_columns_payload(uc, asset_fqn)
        if include_columns and is_openable
        else []
    )
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
        "columns": columns_payload,
        "details": {
            "fqn": asset_fqn,
            "description": asset_service.normalize_str(row.get("comment"))
            or (
                "This related asset is present in lineage metadata, but its live record is not currently openable from this workspace."
                if not is_openable
                else asset_service.PLACEHOLDER_DESCRIPTION
            ),
            "governanceStatus": asset_service.normalize_str(row.get("governance_status"))
            or "Needs Work",
            "domain": asset_service.normalize_str(row.get("domain")) or "Unassigned",
            "tier": asset_service.normalize_str(row.get("tier")) or "Unassigned",
            "certification": asset_service.normalize_str(row.get("certification")) or "Unassigned",
            "sensitivity": asset_service.normalize_str(row.get("sensitivity")) or "Unassigned",
            "isOpenable": is_openable,
            "resolutionState": "resolved" if is_openable else "lineage-only",
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


def _column_lineage_payload(
    uc: UCSQLClient,
    asset_fqn: str,
    *,
    system_uc: Optional[UCSQLClient] = None,
) -> Dict[str, Any]:
    # system.access.column_lineage applies row-level filtering to match the
    # querying principal's SELECT grants on source/target tables. When the actor
    # has OBO but lacks SELECT on upstream bronze tables, the query returns zero
    # rows even though lineage exists. Catalog tools uniformly show crawler-view
    # lineage to authorized viewers, so route system-table reads through the
    # app-principal client when one is supplied.
    system_client = system_uc or uc
    catalog, schema, table = asset_service.split_uc_name(asset_fqn)
    try:
        upstream_df = system_client.get_column_lineage_upstream(
            catalog,
            schema,
            table,
            limit=COLUMN_LINEAGE_LIMIT,
        )
    except Exception:
        upstream_df = pd.DataFrame()
    try:
        downstream_df = system_client.get_column_lineage_downstream(
            catalog,
            schema,
            table,
            limit=COLUMN_LINEAGE_LIMIT,
        )
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
        "meta": {
            "limit": COLUMN_LINEAGE_LIMIT,
            "truncated": bool(
                (upstream_df is not None and len(upstream_df.index) >= COLUMN_LINEAGE_LIMIT)
                or (downstream_df is not None and len(downstream_df.index) >= COLUMN_LINEAGE_LIMIT)
            ),
        },
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
            # A5.2 — reserved slot for the SQL snippet that produced the
            # relationship (view definition, job SQL, etc). Unity Catalog
            # system tables do not expose this uniformly yet, so we emit
            # None and let the frontend render a muted placeholder. When a
            # downstream crawler starts populating this field it flows
            # through to the edge drawer without frontend changes.
            "sqlSnippet": None,
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


def _first_hop_assets(data_graph: Dict[str, Any]) -> Dict[str, List[str]]:
    focus_id = next(
        (node.get("id") for node in data_graph.get("nodes", []) if node.get("role") == "focus"),
        "",
    )
    node_lookup = {
        asset_service.normalize_str(node.get("id")): node
        for node in data_graph.get("nodes", []) or []
    }
    upstream: List[str] = []
    downstream: List[str] = []
    for edge in data_graph.get("edges", []) or []:
        source_id = asset_service.normalize_str(edge.get("source"))
        target_id = asset_service.normalize_str(edge.get("target"))
        if target_id == focus_id:
            asset_fqn = asset_service.normalize_str(
                node_lookup.get(source_id, {}).get("assetFqn")
            )
            if asset_fqn:
                upstream.append(asset_fqn)
        elif source_id == focus_id:
            asset_fqn = asset_service.normalize_str(
                node_lookup.get(target_id, {}).get("assetFqn")
            )
            if asset_fqn:
                downstream.append(asset_fqn)
    return {
        "upstream": list(dict.fromkeys(upstream)),
        "downstream": list(dict.fromkeys(downstream)),
    }


def _lineage_neighbors(
    uc: UCSQLClient,
    asset_fqn: str,
    *,
    direction: str,
    limit: int,
    system_uc: Optional[UCSQLClient] = None,
) -> List[str]:
    system_client = system_uc or uc
    try:
        catalog, schema, table = asset_service.split_uc_name(asset_fqn)
    except ValueError:
        return []
    try:
        if direction == "upstream":
            df = system_client.get_table_lineage_upstream(catalog, schema, table, limit=limit)
            column = "source_table_full_name"
        else:
            df = system_client.get_table_lineage_downstream(catalog, schema, table, limit=limit)
            column = "target_table_full_name"
    except Exception:
        return []
    if df is None or df.empty or column not in df.columns:
        return []
    filtered = asset_service.filter_asset_rows(df, [column])
    if filtered.empty or column not in filtered.columns:
        return []
    return [
        asset_service.normalize_str(value)
        for value in filtered[column].dropna().astype(str).tolist()
        if asset_service.normalize_str(value)
    ]


def _lineage_neighbors_batch(
    uc: UCSQLClient,
    asset_fqns: List[str],
    *,
    direction: str,
    limit_per_asset: int,
    system_uc: Optional[UCSQLClient] = None,
) -> Dict[str, List[str]]:
    """Return a {asset_fqn: [neighbor_fqn, ...]} map for a whole BFS
    frontier, issued as a single `system.access.table_lineage` query.

    Collapses N queries-per-level down to 1. The caller still owns the
    deduplication + ordering semantics — this only fans the DB hit out
    once.
    """
    system_client = system_uc or uc
    tuples: List[Tuple[str, str, str]] = []
    tuple_to_fqn: Dict[Tuple[str, str, str], str] = {}
    for fqn in asset_fqns:
        try:
            catalog, schema, table = asset_service.split_uc_name(fqn)
        except ValueError:
            continue
        key = (catalog, schema, table)
        tuples.append(key)
        tuple_to_fqn[key] = asset_service.normalize_str(fqn)
    if not tuples:
        return {}
    try:
        if direction == "upstream":
            df = system_client.get_table_lineage_upstream_batch(tuples, limit_per_table=limit_per_asset)
            origin_cat, origin_sch, origin_tbl = "target_table_catalog", "target_table_schema", "target_table_name"
            neighbor_col = "source_table_full_name"
        else:
            df = system_client.get_table_lineage_downstream_batch(tuples, limit_per_table=limit_per_asset)
            origin_cat, origin_sch, origin_tbl = "source_table_catalog", "source_table_schema", "source_table_name"
            neighbor_col = "target_table_full_name"
    except Exception:
        return {}
    if df is None or df.empty:
        return {}
    if neighbor_col not in df.columns or origin_cat not in df.columns:
        return {}
    # Filter to asset rows (drops NULL-named rows etc.) without collapsing
    # the origin keys we need to group by.
    filtered = asset_service.filter_asset_rows(df, [neighbor_col])
    if filtered.empty:
        return {}
    out: Dict[str, List[str]] = {}
    for _, row in filtered.iterrows():
        origin_key = (
            asset_service.normalize_str(row.get(origin_cat)),
            asset_service.normalize_str(row.get(origin_sch)),
            asset_service.normalize_str(row.get(origin_tbl)),
        )
        origin_fqn = tuple_to_fqn.get(origin_key)
        neighbor_fqn = asset_service.normalize_str(row.get(neighbor_col))
        if not origin_fqn or not neighbor_fqn:
            continue
        out.setdefault(origin_fqn, []).append(neighbor_fqn)
    # Preserve per-origin cap so we don't over-fan
    for fqn in list(out.keys()):
        seen: Set[str] = set()
        deduped: List[str] = []
        for n in out[fqn]:
            if n not in seen:
                seen.add(n)
                deduped.append(n)
                if len(deduped) >= limit_per_asset:
                    break
        out[fqn] = deduped
    return out


def _recursive_branch_graph(
    uc: UCSQLClient,
    store: Any,
    focus_fqn: str,
    *,
    direction: str,
    depth_limit: int,
    node_limit: int,
    per_hop_limit: int,
    visible_inventory: Optional[pd.DataFrame] = None,
    system_uc: Optional[UCSQLClient] = None,
) -> Dict[str, Any]:
    focus_fqn_n = asset_service.normalize_str(focus_fqn)
    branch_role = "source" if direction == "upstream" else "target"
    branch_kicker = "Upstream" if direction == "upstream" else "Downstream"
    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []
    seen_node_ids: Set[str] = set()
    seen_edges: Set[str] = set()
    visited_assets: Set[str] = {focus_fqn_n}
    truncated = False

    def node_id_for(asset_fqn: str) -> str:
        asset_fqn_n = asset_service.normalize_str(asset_fqn)
        if asset_fqn_n == focus_fqn_n:
            return f"focus-{focus_fqn_n}"
        return f"{branch_role}-{asset_fqn_n}"

    # Batched BFS: instead of one `system.access.table_lineage` query per
    # frontier node, issue ONE batched query per BFS level. For a depth=2
    # walk over ~10 nodes this collapses ~10 roundtrips into 2, which is
    # the dominant chunk of cold-load time in the lineage workspace.
    current_frontier: List[str] = [focus_fqn_n]
    current_depth = 0
    while current_frontier and current_depth < depth_limit:
        neighbors_by_origin = _lineage_neighbors_batch(
            uc,
            current_frontier,
            direction=direction,
            limit_per_asset=max(TABLE_LINEAGE_LIMIT, per_hop_limit),
            system_uc=system_uc,
        )
        next_frontier: List[str] = []
        for current_fqn in current_frontier:
            neighbor_candidates: List[str] = []
            for neighbor in neighbors_by_origin.get(current_fqn, []):
                neighbor_fqn = asset_service.normalize_str(neighbor)
                if (
                    not neighbor_fqn
                    or neighbor_fqn == current_fqn
                    or neighbor_fqn == focus_fqn_n
                    or neighbor_fqn in neighbor_candidates
                ):
                    continue
                neighbor_candidates.append(neighbor_fqn)

            if len(neighbor_candidates) > per_hop_limit:
                truncated = True
            neighbors = neighbor_candidates[:per_hop_limit]

            for neighbor_fqn in neighbors:
                if len(nodes) >= node_limit and neighbor_fqn not in visited_assets:
                    truncated = True
                    break

                if neighbor_fqn not in visited_assets:
                    node = graph_node_for_asset(
                        uc,
                        store,
                        neighbor_fqn,
                        branch_role,
                        0,
                        0,
                        kicker=branch_kicker,
                        depth=current_depth + 1,
                        visible_inventory=visible_inventory,
                    )
                    node_id = asset_service.normalize_str(node.get("id"))
                    if node_id not in seen_node_ids:
                        nodes.append(node)
                        seen_node_ids.add(node_id)
                    visited_assets.add(neighbor_fqn)
                    if current_depth + 1 < depth_limit:
                        next_frontier.append(neighbor_fqn)

                current_node_id = node_id_for(current_fqn)
                neighbor_node_id = node_id_for(neighbor_fqn)
                source_id = neighbor_node_id if direction == "upstream" else current_node_id
                target_id = current_node_id if direction == "upstream" else neighbor_node_id
                edge_key = _data_edge_key(source_id, target_id)
                if edge_key in seen_edges:
                    continue
                edges.append(
                    {
                        "source": source_id,
                        "target": target_id,
                        "depth": current_depth + 1,
                        "key": edge_key,
                    }
                )
                seen_edges.add(edge_key)

            if len(nodes) >= node_limit:
                truncated = True
                break

        if len(nodes) >= node_limit:
            break
        current_frontier = next_frontier
        current_depth += 1

    return {
        "nodes": nodes,
        "edges": edges,
        "truncated": truncated,
        "nodeLimit": node_limit,
        "depthLimit": depth_limit,
        "perHopLimit": per_hop_limit,
    }


def _second_hop_payload(
    uc: UCSQLClient,
    focus_fqn: str,
    first_hop_assets: List[str],
    *,
    direction: str,
    system_uc: Optional[UCSQLClient] = None,
) -> Dict[str, Any]:
    if not first_hop_assets:
        return {
            "seedCount": 0,
            "processedSeedCount": 0,
            "uniqueNeighborCount": 0,
            "neighborSamples": [],
            "seedSummaries": [],
            "limit": {
                "seedAssets": SECOND_HOP_SEED_LIMIT,
                "neighborsPerSeed": SECOND_HOP_NEIGHBOR_LIMIT,
            },
        }

    discovered: List[str] = []
    seed_summaries: List[Dict[str, Any]] = []
    first_hop_set = {asset_service.normalize_str(value) for value in first_hop_assets}
    focus_n = asset_service.normalize_str(focus_fqn)
    for seed_asset in first_hop_assets[:SECOND_HOP_SEED_LIMIT]:
        seed_n = asset_service.normalize_str(seed_asset)
        neighbors = _lineage_neighbors(
            uc,
            seed_n,
            direction=direction,
            limit=SECOND_HOP_NEIGHBOR_LIMIT,
            system_uc=system_uc,
        )
        clean_neighbors: List[str] = []
        for neighbor in neighbors:
            neighbor_n = asset_service.normalize_str(neighbor)
            if not neighbor_n or neighbor_n == focus_n or neighbor_n in first_hop_set:
                continue
            clean_neighbors.append(neighbor_n)
            if neighbor_n not in discovered:
                discovered.append(neighbor_n)
        seed_summaries.append(
            {
                "assetFqn": seed_n,
                "neighborCount": len(clean_neighbors),
                "neighbors": clean_neighbors[:5],
            }
        )

    return {
        "seedCount": len(first_hop_assets),
        "processedSeedCount": min(len(first_hop_assets), SECOND_HOP_SEED_LIMIT),
        "uniqueNeighborCount": len(discovered),
        "neighborSamples": discovered[:SECOND_HOP_SAMPLE_LIMIT],
        "seedSummaries": seed_summaries,
        "limit": {
            "seedAssets": SECOND_HOP_SEED_LIMIT,
            "neighborsPerSeed": SECOND_HOP_NEIGHBOR_LIMIT,
        },
    }


def _lineage_depth_payload(
    uc: UCSQLClient,
    focus_fqn: str,
    data_graph: Dict[str, Any],
    *,
    system_uc: Optional[UCSQLClient] = None,
    include_second_hop: bool = False,
) -> Dict[str, Any]:
    """Compute first-hop asset lists (cheap — derived from the already-built
    data_graph) plus optionally the second-hop neighbor expansion.

    The two-hop expansion costs 2×SECOND_HOP_SEED_LIMIT system.access
    queries (6 upstream + 6 downstream by default), which on cold loads
    adds seconds to the primary lineage fetch. Neither the frontend nor
    any current test consumes the `lineageDepth.twoHop` payload, so we
    default to ``include_second_hop=False`` on the main build and expose
    the full expansion via a separate `/api/lineage/{fqn}/depth` endpoint
    for clients that want the richer summary.
    """

    first_hop = _first_hop_assets(data_graph)
    if not include_second_hop:
        deferred = {
            "seedCount": 0,
            "processedSeedCount": 0,
            "uniqueNeighborCount": 0,
            "neighborSamples": [],
            "seedSummaries": [],
            "deferred": True,
            "limit": {
                "seedAssets": SECOND_HOP_SEED_LIMIT,
                "neighborsPerSeed": SECOND_HOP_NEIGHBOR_LIMIT,
            },
        }
        return {
            "oneHop": first_hop,
            "twoHop": {
                "upstream": deferred,
                "downstream": dict(deferred),
            },
        }

    upstream_second_hop = _second_hop_payload(
        uc,
        focus_fqn,
        first_hop.get("upstream", []),
        direction="upstream",
        system_uc=system_uc,
    )
    downstream_second_hop = _second_hop_payload(
        uc,
        focus_fqn,
        first_hop.get("downstream", []),
        direction="downstream",
        system_uc=system_uc,
    )
    return {
        "oneHop": first_hop,
        "twoHop": {
            "upstream": upstream_second_hop,
            "downstream": downstream_second_hop,
        },
    }


def build_data_graph(
    uc: UCSQLClient,
    store: Any,
    asset_fqn: str,
    *,
    system_uc: Optional[UCSQLClient] = None,
) -> Dict[str, Any]:
    row = asset_service.inventory_row(uc, store, asset_fqn)
    visible_inventory = asset_service.visible_assets(uc, store)
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
        visible_inventory=visible_inventory,
        include_columns=True,
    )
    per_branch_limit = max(8, LINEAGE_GRAPH_NODE_LIMIT // 2)
    upstream_branch = _recursive_branch_graph(
        uc,
        store,
        asset_fqn,
        direction="upstream",
        depth_limit=LINEAGE_GRAPH_DEPTH_LIMIT,
        node_limit=per_branch_limit,
        per_hop_limit=LINEAGE_GRAPH_PER_HOP_LIMIT,
        visible_inventory=visible_inventory,
        system_uc=system_uc,
    )
    downstream_branch = _recursive_branch_graph(
        uc,
        store,
        asset_fqn,
        direction="downstream",
        depth_limit=LINEAGE_GRAPH_DEPTH_LIMIT,
        node_limit=per_branch_limit,
        per_hop_limit=LINEAGE_GRAPH_PER_HOP_LIMIT,
        visible_inventory=visible_inventory,
        system_uc=system_uc,
    )

    nodes = [focus, *upstream_branch["nodes"], *downstream_branch["nodes"]]
    edges = [*upstream_branch["edges"], *downstream_branch["edges"]]

    return {
        "nodes": nodes,
        "edges": edges,
        "meta": {
            "upstreamLimit": TABLE_LINEAGE_LIMIT,
            "downstreamLimit": TABLE_LINEAGE_LIMIT,
            "graphDepthLimit": LINEAGE_GRAPH_DEPTH_LIMIT,
            "graphNodeLimit": LINEAGE_GRAPH_NODE_LIMIT,
            "graphBranchNodeLimit": per_branch_limit,
            "graphPerHopLimit": LINEAGE_GRAPH_PER_HOP_LIMIT,
            "upstreamTruncated": bool(upstream_branch.get("truncated")),
            "downstreamTruncated": bool(downstream_branch.get("truncated")),
        },
    }


def build_operational_graph(
    uc: UCSQLClient,
    store: Any,
    asset_fqn: str,
    *,
    system_uc: Optional[UCSQLClient] = None,
) -> Dict[str, Any]:
    system_client = system_uc or uc
    row = asset_service.inventory_row(uc, store, asset_fqn)
    visible_inventory = asset_service.visible_assets(uc, store)
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
        visible_inventory=visible_inventory,
        include_columns=True,
    )
    try:
        upstream_df = metadata_service.enrich_operational_context_names(
            uc,
            system_client.get_operational_context_upstream(
                catalog,
                schema,
                table,
                limit=OPERATIONAL_CONTEXT_LIMIT,
            ),
        )
    except Exception:
        upstream_df = pd.DataFrame()
    try:
        downstream_df = metadata_service.enrich_operational_context_names(
            uc,
            system_client.get_operational_context_downstream(
                catalog,
                schema,
                table,
                limit=OPERATIONAL_CONTEXT_LIMIT,
            ),
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

    return {
        "nodes": nodes,
        "edges": edges,
        "meta": {
            "producerLimit": OPERATIONAL_CONTEXT_LIMIT,
            "consumerLimit": OPERATIONAL_CONTEXT_LIMIT,
            "producerTruncated": bool(
                upstream_df is not None and len(upstream_df.index) >= OPERATIONAL_CONTEXT_LIMIT
            ),
            "consumerTruncated": bool(
                downstream_df is not None and len(downstream_df.index) >= OPERATIONAL_CONTEXT_LIMIT
            ),
        },
    }


def lineage_payload(
    uc: UCSQLClient,
    store: Any,
    asset_fqn: str,
    *,
    cache_scope: str = "",
    system_uc: Optional[UCSQLClient] = None,
) -> Dict[str, Any]:
    return _ttl_value(
        (
            f"lineage:{_warehouse_key(uc)}:{_cache_scope_key(cache_scope)}:"
            f"{asset_service.normalize_str(asset_fqn)}"
        ),
        # Lineage edges in system.access.table_lineage change slowly —
        # new pipelines write new rows, but existing relationships don't
        # vanish. A 30-minute TTL keeps warm sessions hot without making
        # stewards wait out a re-roundtrip they didn't ask for. First
        # load still pays the cold query cost; subsequent hits within
        # 30 min are instant.
        1800,
        lambda: _build_lineage_payload(uc, store, asset_fqn, system_uc=system_uc),
    )


def _build_lineage_payload(
    uc: UCSQLClient,
    store: Any,
    asset_fqn: str,
    *,
    system_uc: Optional[UCSQLClient] = None,
) -> Dict[str, Any]:
    # Data graph, operational graph, and column lineage are independent
    # network-bound SQL paths. Running them concurrently cuts cold-load
    # wall time roughly 3x vs. the old sequential build.
    with ThreadPoolExecutor(max_workers=3) as executor:
        data_future = executor.submit(
            build_data_graph, uc, store, asset_fqn, system_uc=system_uc
        )
        operational_future = executor.submit(
            build_operational_graph, uc, store, asset_fqn, system_uc=system_uc
        )
        column_future = executor.submit(
            _column_lineage_payload, uc, asset_fqn, system_uc=system_uc
        )
        data_graph = data_future.result()
        operational_graph = operational_future.result()
        column_lineage = column_future.result()
    lineage_depth = _lineage_depth_payload(uc, asset_fqn, data_graph, system_uc=system_uc)
    data_edge_details = _data_edge_details(data_graph, column_lineage)
    operational_edge_details = _operational_edge_details(operational_graph)
    data_focus_id = next(
        (node.get("id") for node in data_graph.get("nodes", []) if node.get("role") == "focus"),
        "",
    )

    return {
        "fqn": asset_fqn,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        "graphs": {
            "data": data_graph,
            "operational": operational_graph,
        },
        "columnLineage": column_lineage,
        "lineageDepth": lineage_depth,
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
            "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "limits": {
                "tableLineage": TABLE_LINEAGE_LIMIT,
                "columnLineage": COLUMN_LINEAGE_LIMIT,
                "operationalContext": OPERATIONAL_CONTEXT_LIMIT,
                "secondHopSeedAssets": SECOND_HOP_SEED_LIMIT,
                "secondHopNeighborsPerSeed": SECOND_HOP_NEIGHBOR_LIMIT,
                "graphDepth": LINEAGE_GRAPH_DEPTH_LIMIT,
                "graphNodes": LINEAGE_GRAPH_NODE_LIMIT,
                "graphNeighborsPerHop": LINEAGE_GRAPH_PER_HOP_LIMIT,
            },
            "truncated": {
                "upstream": bool(data_graph.get("meta", {}).get("upstreamTruncated")),
                "downstream": bool(data_graph.get("meta", {}).get("downstreamTruncated")),
                "columnLineage": bool(column_lineage.get("meta", {}).get("truncated")),
                "operationalProducers": bool(operational_graph.get("meta", {}).get("producerTruncated")),
                "operationalConsumers": bool(operational_graph.get("meta", {}).get("consumerTruncated")),
            },
            "depth": {
                "oneHopUpstreamAssets": len(lineage_depth.get("oneHop", {}).get("upstream", [])),
                "oneHopDownstreamAssets": len(lineage_depth.get("oneHop", {}).get("downstream", [])),
                "twoHopUpstreamAssets": int(
                    lineage_depth.get("twoHop", {}).get("upstream", {}).get("uniqueNeighborCount", 0)
                ),
                "twoHopDownstreamAssets": int(
                    lineage_depth.get("twoHop", {}).get("downstream", {}).get("uniqueNeighborCount", 0)
                ),
            },
        },
    }


# -----------------------------------------------------------------------------
# Phase 9 — multi-hop column lineage
# -----------------------------------------------------------------------------


COLUMN_LINEAGE_HOP_LIMIT = 4
COLUMN_LINEAGE_MAX_NODES = 64
COLUMN_LINEAGE_PER_HOP_FANOUT = 8


def trace_multi_hop_column_lineage(
    *,
    asset_fqn: str,
    column_name: str,
    direction: str,
    depth: int,
    fetch_neighbors: Callable[[str, str], List[Dict[str, str]]],
    hop_limit: int = COLUMN_LINEAGE_HOP_LIMIT,
    per_hop_fanout: int = COLUMN_LINEAGE_PER_HOP_FANOUT,
    max_nodes: int = COLUMN_LINEAGE_MAX_NODES,
) -> Dict[str, Any]:
    """Walk column lineage depth-first with bounded fan-out + node budget.

    `fetch_neighbors(asset_fqn, column_name)` returns a list of
    {assetFqn, column} dicts representing neighbours in the given
    direction. The traversal is direction-specific — the caller picks
    upstream vs downstream and wires the right callback.

    Returns:
        {
            "nodes": [ { "id", "assetFqn", "column", "depth" }, ... ],
            "edges": [ { "source", "target", "depth" }, ... ],
            "meta": { "direction", "depthLimit", "truncated", "reason" }
        }

    Pure function — the fetch callback is the only I/O and is supplied
    by the router. That keeps this unit-testable and the production
    shape injectable against live UC or a mock.
    """
    direction_norm = (direction or "").strip().lower()
    if direction_norm not in ("upstream", "downstream"):
        raise ValueError("direction must be 'upstream' or 'downstream'")
    depth_requested = max(1, min(int(depth or 1), hop_limit))

    root_id = f"{asset_fqn}#{column_name}"
    nodes: Dict[str, Dict[str, Any]] = {
        root_id: {
            "id": root_id,
            "assetFqn": asset_fqn,
            "column": column_name,
            "depth": 0,
        }
    }
    edges: List[Dict[str, Any]] = []
    seen_edges: Set[Tuple[str, str]] = set()
    truncated = False
    truncation_reason: Optional[str] = None

    frontier: Deque[Tuple[str, str, int]] = deque([(asset_fqn, column_name, 0)])
    while frontier:
        current_asset, current_column, current_depth = frontier.popleft()
        if current_depth >= depth_requested:
            continue
        try:
            neighbors = fetch_neighbors(current_asset, current_column) or []
        except Exception:
            neighbors = []
        if len(neighbors) > per_hop_fanout:
            truncated = True
            truncation_reason = truncation_reason or "per-hop fanout cap"
            neighbors = neighbors[:per_hop_fanout]
        current_id = f"{current_asset}#{current_column}"
        for neighbor in neighbors:
            neighbor_asset = asset_service.normalize_str(neighbor.get("assetFqn"))
            neighbor_column = asset_service.normalize_str(neighbor.get("column"))
            if not neighbor_asset or not neighbor_column:
                continue
            neighbor_id = f"{neighbor_asset}#{neighbor_column}"
            if neighbor_id not in nodes:
                if len(nodes) >= max_nodes:
                    truncated = True
                    truncation_reason = truncation_reason or "node budget"
                    continue
                nodes[neighbor_id] = {
                    "id": neighbor_id,
                    "assetFqn": neighbor_asset,
                    "column": neighbor_column,
                    "depth": current_depth + 1,
                }
            # Direction of the edge matches the requested direction —
            # for upstream, neighbor feeds current (neighbor -> current).
            if direction_norm == "upstream":
                edge_key = (neighbor_id, current_id)
            else:
                edge_key = (current_id, neighbor_id)
            if edge_key not in seen_edges:
                seen_edges.add(edge_key)
                edges.append(
                    {"source": edge_key[0], "target": edge_key[1], "depth": current_depth + 1}
                )
            if current_depth + 1 < depth_requested:
                frontier.append((neighbor_asset, neighbor_column, current_depth + 1))

    return {
        "nodes": list(nodes.values()),
        "edges": edges,
        "meta": {
            "direction": direction_norm,
            "depthLimit": depth_requested,
            "hopLimit": hop_limit,
            "maxNodes": max_nodes,
            "perHopFanout": per_hop_fanout,
            "truncated": bool(truncated),
            "reason": truncation_reason,
            "rootAssetFqn": asset_fqn,
            "rootColumn": column_name,
        },
    }


def build_upstream_column_fetcher(
    system_uc: UCSQLClient,
    *,
    limit_per_call: int = COLUMN_LINEAGE_LIMIT,
) -> Callable[[str, str], List[Dict[str, str]]]:
    """Return a closure that queries system.access.column_lineage for a
    single (asset, column) to its immediate upstream neighbors. The
    closure is suitable as the fetch_neighbors callback."""

    def _fetch(asset_fqn: str, column_name: str) -> List[Dict[str, str]]:
        catalog, schema, table = asset_service.split_uc_name(asset_fqn)
        if not (catalog and schema and table and column_name):
            return []
        frame = system_uc.get_column_lineage_upstream(catalog, schema, table, limit=limit_per_call)
        if frame is None or frame.empty:
            return []
        results: List[Dict[str, str]] = []
        for _, row in frame.iterrows():
            target_column = asset_service.normalize_str(row.get("target_column_name"))
            if target_column.lower() != column_name.lower():
                continue
            results.append(
                {
                    "assetFqn": asset_service.normalize_str(row.get("source_table_full_name")),
                    "column": asset_service.normalize_str(row.get("source_column_name")),
                }
            )
        return results

    return _fetch


def build_downstream_column_fetcher(
    system_uc: UCSQLClient,
    *,
    limit_per_call: int = COLUMN_LINEAGE_LIMIT,
) -> Callable[[str, str], List[Dict[str, str]]]:
    def _fetch(asset_fqn: str, column_name: str) -> List[Dict[str, str]]:
        catalog, schema, table = asset_service.split_uc_name(asset_fqn)
        if not (catalog and schema and table and column_name):
            return []
        frame = system_uc.get_column_lineage_downstream(catalog, schema, table, limit=limit_per_call)
        if frame is None or frame.empty:
            return []
        results: List[Dict[str, str]] = []
        for _, row in frame.iterrows():
            source_column = asset_service.normalize_str(row.get("source_column_name"))
            if source_column.lower() != column_name.lower():
                continue
            results.append(
                {
                    "assetFqn": asset_service.normalize_str(row.get("target_table_full_name")),
                    "column": asset_service.normalize_str(row.get("target_column_name")),
                }
            )
        return results

    return _fetch
