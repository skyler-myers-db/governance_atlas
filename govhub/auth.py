from __future__ import annotations

from typing import Dict, Optional

import streamlit as st


def get_headers() -> Dict[str, str]:
    """Streamlit in Databricks Apps provides request headers via st.context.headers."""
    try:
        headers = dict(st.context.headers)  # type: ignore[attr-defined]
    except Exception:
        headers = {}
    return {str(k).lower(): str(v) for k, v in headers.items()}


def get_current_user_email() -> Optional[str]:
    headers = get_headers()
    email = headers.get("x-forwarded-email") or headers.get(
        "x-forwarded-preferred-username"
    )
    if email:
        return email.strip()
    return None
