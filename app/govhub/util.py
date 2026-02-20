from __future__ import annotations

import re
from typing import Iterable, Mapping

_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

def sql_literal(value: str | None) -> str:
    """Return a SQL string literal (single quotes) with safe escaping."""
    if value is None:
        return "NULL"
    return "'" + value.replace("'", "''") + "'"

def quote_ident(identifier: str) -> str:
    """Quote a Unity Catalog identifier using backticks."""
    # Backticks inside identifiers are escaped by doubling them.
    safe = identifier.replace("`", "``")
    return f"`{safe}`"

def quote_uc_3part(catalog: str, schema: str, name: str) -> str:
    return f"{quote_ident(catalog)}.{quote_ident(schema)}.{quote_ident(name)}"

def normalize_uc_full_name(uc_full_name: str) -> str:
    """Normalize a UC 3-part name 'catalog.schema.table' (best-effort)."""
    return uc_full_name.strip()

def format_set_tags_clause(tags: Mapping[str, str]) -> str:
    """Build a SET TAGS (k = v, ...) clause using SQL string literals for values."""
    # tag_name (key) is treated as an identifier in Databricks SQL tag syntax, but it can include characters.
    # We'll quote it as an identifier to be safe.
    parts = []
    for k, v in tags.items():
        parts.append(f"{quote_ident(k)} = {sql_literal(v)}")
    return ", ".join(parts)

def format_unset_tags_clause(tag_keys: Iterable[str]) -> str:
    keys = [quote_ident(k) for k in tag_keys]
    return ", ".join(keys)
