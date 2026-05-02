from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List

from atlas.config import AppConfig
from atlas.services.assets import normalize_str


@dataclass(frozen=True)
class GenieProviderStatus:
    state: str
    provider: str
    message: str
    space_id: str = ""
    space_title: str = ""
    benchmark_state: str = ""

    def as_dict(self) -> Dict[str, Any]:
        return {
            "state": self.state,
            "provider": self.provider,
            "message": self.message,
            "spaceId": self.space_id,
            "spaceTitle": self.space_title,
            "benchmarkState": self.benchmark_state,
        }


def _cfg(config: AppConfig, name: str, default: Any = "") -> Any:
    return getattr(config, name, default)


def provider_status(config: AppConfig) -> Dict[str, Any]:
    provider = normalize_str(_cfg(config, "atlas_ai_provider", "local")).lower() or "local"
    space_id = normalize_str(_cfg(config, "genie_space_id"))
    space_title = normalize_str(_cfg(config, "genie_space_title")) or "Governance Atlas Metadata Room"
    if provider != "genie":
        return GenieProviderStatus(
            state="degraded",
            provider="local",
            message="Atlas AI is using the local evidence engine until a Genie space is configured.",
            space_title=space_title,
        ).as_dict()
    if not space_id:
        return GenieProviderStatus(
            state="unavailable",
            provider="genie",
            message="Atlas AI is configured for Genie, but GOVAT_GENIE_SPACE_ID is missing.",
            space_title=space_title,
        ).as_dict()
    benchmark_state = "required" if bool(_cfg(config, "atlas_ai_require_benchmark", False)) else "not_required"
    return GenieProviderStatus(
        state="available",
        provider="genie",
        message="Atlas AI Genie space is configured.",
        space_id=space_id,
        space_title=space_title,
        benchmark_state=benchmark_state,
    ).as_dict()


def _workspace_client(config: AppConfig | None = None, user_access_token: str = ""):
    try:
        from databricks.sdk import WorkspaceClient
    except ImportError as exc:
        raise RuntimeError("databricks-sdk is required for Genie-backed Atlas AI.") from exc
    token = normalize_str(user_access_token)
    host = normalize_str(_cfg(config, "workspace_host")) if config is not None else ""
    if token and host:
        return WorkspaceClient(
            host=host,
            token=token,
            auth_type="pat",
            product="governance-atlas",
            product_version="atlas-genie-obo",
        )
    return WorkspaceClient()


def _obj_get(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _as_dict(obj: Any) -> Dict[str, Any]:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    as_dict = getattr(obj, "as_dict", None)
    if callable(as_dict):
        try:
            return as_dict()
        except Exception:
            return {}
    return {}


def _attachment_records(message: Any) -> List[Dict[str, Any]]:
    attachments = _obj_get(message, "attachments") or []
    records: List[Dict[str, Any]] = []
    for attachment in attachments:
        record = _as_dict(attachment)
        text = _obj_get(attachment, "text")
        query = _obj_get(attachment, "query")
        if text is not None:
            text_dict = _as_dict(text)
            record.setdefault("text", text_dict)
            content = _obj_get(text, "content")
            if content and "content" not in record["text"]:
                record["text"]["content"] = content
        if query is not None:
            query_dict = _as_dict(query)
            record.setdefault("query", query_dict)
            for field in ["query", "title", "description", "statement_id", "query_result_metadata"]:
                value = _obj_get(query, field)
                if value and field not in record["query"]:
                    record["query"][field] = value
        records.append(record)
    return records


def _text_from_attachments(records: Iterable[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for record in records:
        text = record.get("text") if isinstance(record, dict) else None
        if isinstance(text, dict):
            content = normalize_str(text.get("content"))
            if content:
                parts.append(content)
    return "\n\n".join(parts).strip()


def _query_evidence(records: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    evidence: List[Dict[str, Any]] = []
    for record in records:
        query = record.get("query") if isinstance(record, dict) else None
        if not isinstance(query, dict):
            continue
        generated_sql = normalize_str(query.get("query"))
        if not generated_sql:
            continue
        metadata = query.get("query_result_metadata") or {}
        if not isinstance(metadata, dict):
            metadata = {}
        evidence.append(
            {
                "type": "genie_query",
                "metric": "generatedSql",
                "id": normalize_str(record.get("attachment_id") or query.get("id")),
                "title": normalize_str(query.get("title")),
                "statementId": normalize_str(query.get("statement_id")),
                "rowCount": metadata.get("row_count"),
                "isTruncated": metadata.get("is_truncated"),
                "sql": generated_sql,
            }
        )
    return evidence


def _result_columns(statement: Any) -> List[str]:
    manifest = _obj_get(statement, "manifest")
    schema = _obj_get(manifest, "schema")
    columns = _obj_get(schema, "columns") or []
    names: List[str] = []
    for column in columns:
        name = normalize_str(_obj_get(column, "name"))
        if name:
            names.append(name)
    return names


def _result_rows(statement: Any, columns: List[str], limit: int = 10) -> List[Dict[str, Any]]:
    result = _obj_get(statement, "result")
    data = _obj_get(result, "data_array") or []
    rows: List[Dict[str, Any]] = []
    for raw_row in data[:limit]:
        if not isinstance(raw_row, list):
            continue
        row = {}
        for index, value in enumerate(raw_row):
            key = columns[index] if index < len(columns) else f"column_{index + 1}"
            row[key] = value
        rows.append(row)
    return rows


def _is_sentinel_no_result_row(row: Dict[str, Any]) -> bool:
    if not isinstance(row, dict):
        return False
    identifier_values = [
        normalize_str(row.get(key)).lower()
        for key in ("asset_fqn", "source_asset_fqn", "target_asset_fqn", "work_id", "audit_id", "term_id")
        if normalize_str(row.get(key))
    ]
    if not any(value in {"unavailable", "none", "no_data", "n/a", "not_applicable"} for value in identifier_values):
        return False
    detail = normalize_str(row.get("detail") or row.get("message") or row.get("status")).lower()
    non_identifier_values = [
        normalize_str(value)
        for key, value in row.items()
        if key not in {"asset_fqn", "source_asset_fqn", "target_asset_fqn", "work_id", "audit_id", "term_id", "detail", "message", "status"}
    ]
    if any(value for value in non_identifier_values):
        return False
    return (
        not detail
        or "no data" in detail
        or "no quality issues" in detail
        or "not available" in detail
        or "unavailable" in detail
    )


def _strip_sentinel_no_result_rows(rows: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], bool]:
    cleaned = [row for row in rows if not _is_sentinel_no_result_row(row)]
    return cleaned, len(cleaned) != len(rows)


def _total_row_count(statement: Any, fallback: Any = None) -> Any:
    manifest = _obj_get(statement, "manifest")
    value = _obj_get(manifest, "total_row_count")
    if value is not None:
        return value
    result = _obj_get(statement, "result")
    value = _obj_get(result, "row_count")
    return fallback if value is None else value


def _attach_statement_results(client: Any, evidence: List[Dict[str, Any]]) -> List[str]:
    warnings: List[str] = []
    statement_execution = getattr(client, "statement_execution", None)
    get_statement = getattr(statement_execution, "get_statement", None)
    if not callable(get_statement):
        return warnings
    for item in evidence:
        statement_id = normalize_str(item.get("statementId"))
        if not statement_id:
            continue
        try:
            statement = get_statement(statement_id)
        except Exception as exc:
            warnings.append(f"Could not fetch Genie statement results for {statement_id}: {exc.__class__.__name__}: {exc}")
            continue
        columns = _result_columns(statement)
        rows = _result_rows(statement, columns)
        rows, stripped_sentinel = _strip_sentinel_no_result_rows(rows)
        if columns:
            item["resultColumns"] = columns
        if rows:
            item["resultRows"] = rows
        elif "resultRows" in item:
            item.pop("resultRows", None)
        total_rows = _total_row_count(statement, item.get("rowCount"))
        if stripped_sentinel:
            total_rows = 0
            item["rowCount"] = 0
            item["totalRowCount"] = 0
            warnings.append(
                f"Removed Genie sentinel no-result row for {statement_id}; no governed result row was counted."
            )
        if total_rows is not None:
            item["rowCount"] = total_rows
            item["totalRowCount"] = total_rows
    return warnings


def _positive_row_count(evidence: Iterable[Dict[str, Any]]) -> int:
    total = 0
    for item in evidence:
        try:
            total += int(item.get("rowCount") or item.get("totalRowCount") or 0)
        except Exception:
            continue
    return total


def _answer_conflicts_with_rows(answer: str, evidence: Iterable[Dict[str, Any]]) -> bool:
    if _positive_row_count(evidence) <= 0:
        return False
    prefix = normalize_str(answer).lower()[:260]
    if not prefix:
        return False
    return any(
        phrase in prefix
        for phrase in [
            "there are no",
            "no results",
            "no rows",
            "no critical assets",
            "none found",
            "not found",
            "no data",
        ]
    )


def _markdown_table(rows: List[Dict[str, Any]], *, max_columns: int = 6, max_rows: int = 8) -> str:
    if not rows:
        return ""
    columns = list(rows[0].keys())[:max_columns]
    def cell(value: Any) -> str:
        text = normalize_str(value)
        text = text.replace("|", "\\|")
        return text[:120] + ("..." if len(text) > 120 else "")
    header = "| " + " | ".join(columns) + " |"
    divider = "| " + " | ".join(["---"] * len(columns)) + " |"
    body = [
        "| " + " | ".join(cell(row.get(column)) for column in columns) + " |"
        for row in rows[:max_rows]
    ]
    return "\n".join([header, divider, *body])


def _row_backed_answer(question: str, evidence: List[Dict[str, Any]]) -> str:
    for item in evidence:
        rows = item.get("resultRows") if isinstance(item.get("resultRows"), list) else []
        if not rows:
            continue
        count = item.get("totalRowCount") or item.get("rowCount") or len(rows)
        table = _markdown_table(rows)
        if table:
            return (
                f"Genie returned {count} governed evidence row{'s' if str(count) != '1' else ''} "
                f"for this question. Review the rows and generated SQL before acting.\n\n{table}"
            )
    return "Genie returned governed query evidence for this question. Review the generated SQL before acting."


def _status_value(raw: Any) -> str:
    if raw is None:
        return ""
    value = getattr(raw, "value", raw)
    return str(value or "").strip().upper()


def ask_genie(
    *,
    config: AppConfig,
    question: str,
    client: Any | None = None,
    user_access_token: str = "",
) -> Dict[str, Any]:
    prompt = normalize_str(question)
    if not prompt:
        raise ValueError("Question is required.")
    status = provider_status(config)
    if status.get("state") != "available":
        raise RuntimeError(status.get("message") or "Genie is not configured.")
    w = client or _workspace_client(config, user_access_token=user_access_token)
    message = w.genie.start_conversation_and_wait(
        space_id=status["spaceId"],
        content=prompt,
    )
    message_status = _status_value(_obj_get(message, "status"))
    error = _obj_get(message, "error")
    if error:
        error_payload = _as_dict(error)
        raise RuntimeError(json.dumps(error_payload, sort_keys=True) if error_payload else str(error))
    if message_status and message_status not in {"COMPLETED", "EXECUTING_QUERY"}:
        raise RuntimeError(f"Genie message did not complete successfully: {message_status}")
    attachments = _attachment_records(message)
    answer = _text_from_attachments(attachments)
    evidence = _query_evidence(attachments)
    result_warnings = _attach_statement_results(w, evidence)
    conflict = _answer_conflicts_with_rows(answer, evidence)
    warnings = list(result_warnings)
    if conflict:
        answer = _row_backed_answer(prompt, evidence)
        warnings.append(
            "Genie text conflicted with returned query rows; Atlas AI returned the governed query rows instead."
        )
    if not answer and evidence:
        answer = "Genie generated a governed SQL answer. Review the evidence query before acting."
    return {
        "question": prompt,
        "intent": "genie",
        "answer": answer or "Genie did not return a text answer for this question.",
        "recommendations": [],
        "evidence": evidence,
        "confidence": "genie-grounded" if evidence else "low",
        "provider": "genie",
        "providerState": status,
        "conversationId": normalize_str(_obj_get(message, "conversation_id")),
        "messageId": normalize_str(_obj_get(message, "message_id") or _obj_get(message, "id")),
        "attachments": attachments,
        "warnings": warnings if evidence else [*warnings, "Genie returned no query evidence for this answer."],
    }
