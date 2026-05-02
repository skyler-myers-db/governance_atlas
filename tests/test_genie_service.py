from __future__ import annotations

import unittest
from types import SimpleNamespace

from atlas.config import AppConfig
from atlas.services import genie


class FakeGenieClient:
    def __init__(self, message, statement=None):
        self.genie = SimpleNamespace(start_conversation_and_wait=self.start_conversation_and_wait)
        self.statement_execution = (
            SimpleNamespace(get_statement=lambda statement_id: statement)
            if statement is not None
            else None
        )
        self.message = message
        self.calls = []

    def start_conversation_and_wait(self, **kwargs):
        self.calls.append(kwargs)
        return self.message


class GenieServiceTests(unittest.TestCase):
    def _config(self, **overrides):
        data = {
            "warehouse_id": "warehouse-123",
            "gov_catalog": "datapact",
            "gov_schema": "atlas",
            "genie_space_id": "",
            "genie_space_title": "Governance Atlas Metadata Room",
            "atlas_ai_provider": "local",
        }
        data.update(overrides)
        return AppConfig(**data)

    def test_provider_status_requires_space_id_for_genie(self) -> None:
        status = genie.provider_status(self._config(atlas_ai_provider="genie"))

        self.assertEqual(status["provider"], "genie")
        self.assertEqual(status["state"], "unavailable")
        self.assertIn("GOVAT_GENIE_SPACE_ID", status["message"])

    def test_ask_genie_normalizes_text_and_query_evidence(self) -> None:
        message = SimpleNamespace(
            status="COMPLETED",
            conversation_id="conv-1",
            message_id="msg-1",
            attachments=[
                SimpleNamespace(
                    attachment_id="att-1",
                    text=SimpleNamespace(content="Customer has the highest open work count."),
                    query=SimpleNamespace(
                        query="SELECT domain, count(*) FROM atlas_ai_assets_current GROUP BY domain",
                        title="Domain open work",
                        statement_id="stmt-1",
                        query_result_metadata={"row_count": 3, "is_truncated": False},
                    ),
                )
            ],
        )
        client = FakeGenieClient(message)

        payload = genie.ask_genie(
            config=self._config(atlas_ai_provider="genie", genie_space_id="space-1"),
            question="Which domains need stewardship?",
            client=client,
        )

        self.assertEqual(client.calls[0]["space_id"], "space-1")
        self.assertEqual(payload["provider"], "genie")
        self.assertEqual(payload["answer"], "Customer has the highest open work count.")
        self.assertEqual(payload["confidence"], "genie-grounded")
        self.assertEqual(payload["evidence"][0]["statementId"], "stmt-1")
        self.assertEqual(payload["evidence"][0]["rowCount"], 3)
        self.assertEqual(payload["conversationId"], "conv-1")

    def test_ask_genie_suppresses_negative_answer_when_query_has_rows(self) -> None:
        message = SimpleNamespace(
            status="COMPLETED",
            conversation_id="conv-2",
            message_id="msg-2",
            attachments=[
                SimpleNamespace(
                    attachment_id="att-2",
                    query=SimpleNamespace(
                        query="SELECT asset_fqn FROM atlas_ai_assets_current WHERE is_critical = TRUE",
                        statement_id="stmt-2",
                        query_result_metadata={"row_count": 2},
                    ),
                ),
                SimpleNamespace(
                    text=SimpleNamespace(content="There are no critical assets that are not certified."),
                ),
            ],
        )
        statement = SimpleNamespace(
            manifest=SimpleNamespace(
                total_row_count=2,
                schema=SimpleNamespace(
                    columns=[
                        SimpleNamespace(name="asset_fqn"),
                        SimpleNamespace(name="domain"),
                    ]
                ),
            ),
            result=SimpleNamespace(
                data_array=[
                    ["main.customer.orders", "Customer"],
                    ["main.finance.payments", "Finance"],
                ]
            ),
        )
        client = FakeGenieClient(message, statement=statement)

        payload = genie.ask_genie(
            config=self._config(atlas_ai_provider="genie", genie_space_id="space-1"),
            question="Which critical assets are not certified?",
            client=client,
        )

        self.assertIn("Genie returned 2 governed evidence rows", payload["answer"])
        self.assertIn("main.customer.orders", payload["answer"])
        self.assertIn("text conflicted", payload["warnings"][0].lower())
        self.assertEqual(payload["evidence"][0]["totalRowCount"], 2)

    def test_ask_genie_strips_sentinel_no_result_rows(self) -> None:
        message = SimpleNamespace(
            status="COMPLETED",
            conversation_id="conv-3",
            message_id="msg-3",
            attachments=[
                SimpleNamespace(
                    attachment_id="att-3",
                    text=SimpleNamespace(content="No data quality issues found for critical assets."),
                    query=SimpleNamespace(
                        query=(
                            "SELECT quality.asset_fqn, quality.column_name, quality.detail "
                            "FROM atlas_ai_quality_latest quality "
                            "UNION ALL SELECT 'unavailable', NULL, "
                            "'No data quality issues found for critical assets.'"
                        ),
                        statement_id="stmt-3",
                        query_result_metadata={"row_count": 1},
                    ),
                )
            ],
        )
        statement = SimpleNamespace(
            manifest=SimpleNamespace(
                total_row_count=1,
                schema=SimpleNamespace(
                    columns=[
                        SimpleNamespace(name="asset_fqn"),
                        SimpleNamespace(name="column_name"),
                        SimpleNamespace(name="detail"),
                    ]
                ),
            ),
            result=SimpleNamespace(
                data_array=[
                    ["unavailable", None, "No data quality issues found for critical assets."],
                ]
            ),
        )
        client = FakeGenieClient(message, statement=statement)

        payload = genie.ask_genie(
            config=self._config(atlas_ai_provider="genie", genie_space_id="space-1"),
            question="Show me data quality issues impacting critical assets.",
            client=client,
        )

        self.assertEqual(payload["evidence"][0]["rowCount"], 0)
        self.assertEqual(payload["evidence"][0]["totalRowCount"], 0)
        self.assertNotIn("resultRows", payload["evidence"][0])
        self.assertNotIn("1 governed evidence row", payload["answer"])
        self.assertTrue(any("sentinel no-result" in warning.lower() for warning in payload["warnings"]))


if __name__ == "__main__":
    unittest.main()
