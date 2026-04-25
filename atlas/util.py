from __future__ import annotations

import re
from typing import Iterable, Mapping

_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def sql_literal(value: str | None) -> str:
    """Return a SQL string literal with safe escaping."""
    if value is None:
        return "NULL"
    return "'" + value.replace("'", "''") + "'"


def quote_ident(identifier: str) -> str:
    """Quote a Unity Catalog identifier using backticks."""
    safe = identifier.replace("`", "``")
    return f"`{safe}`"


def quote_uc_3part(catalog: str, schema: str, name: str) -> str:
    return f"{quote_ident(catalog)}.{quote_ident(schema)}.{quote_ident(name)}"
