from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import requests


class DataHubError(RuntimeError):
    pass


@dataclass(frozen=True)
class DataHubSearchResult:
    urn: str
    type: str
    name: str
    platform: str | None = None
    description: str | None = None


class DataHubGraphQLClient:
    """Thin GraphQL client for DataHub's /api/graphql endpoint."""

    def __init__(self, gms_url: str, token: str, timeout_s: int = 30):
        if not gms_url:
            raise ValueError("Missing DataHub GMS URL")
        if not token:
            raise ValueError("Missing DataHub token")
        self.endpoint = gms_url.rstrip("/") + "/api/graphql"
        self.timeout_s = timeout_s
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            }
        )

    def execute(self, query: str, variables: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload = {"query": query, "variables": variables or {}}
        resp = self.session.post(self.endpoint, json=payload, timeout=self.timeout_s)
        resp.raise_for_status()
        body = resp.json()

        # DataHub returns GraphQL errors inside a top-level "errors" field.
        if body.get("errors"):
            raise DataHubError(json.dumps(body["errors"], indent=2))
        if "data" not in body:
            raise DataHubError(f"No 'data' in GraphQL response: {body}")
        return body["data"]

    # ---------------- Search ----------------

    def search(self, entity_type: str, query_text: str, start: int = 0, count: int = 10) -> List[DataHubSearchResult]:
        gql = """
        query searchEntities($type: EntityType!, $query: String!, $start: Int!, $count: Int!) {
          search(input: { type: $type, query: $query, start: $start, count: $count }) {
            total
            searchResults {
              entity {
                urn
                type
                ... on Dataset {
                  name
                  platform { name }
                  properties { description }
                }
                ... on GlossaryTerm {
                  urn
                  glossaryTermInfo { name description }
                }
                ... on Tag {
                  urn
                  name
                  properties { description }
                }
              }
            }
          }
        }
        """
        data = self.execute(
            gql,
            variables={"type": entity_type, "query": query_text, "start": start, "count": count},
        )
        results: List[DataHubSearchResult] = []
        for r in (((data.get("search") or {}).get("searchResults")) or []):
            e = (r or {}).get("entity") or {}
            urn = e.get("urn")
            etype = e.get("type") or entity_type
            name = e.get("name") or (e.get("glossaryTermInfo") or {}).get("name") or e.get("urn", "")
            platform = None
            if isinstance(e.get("platform"), dict):
                platform = e["platform"].get("name")
            description = None
            if isinstance(e.get("properties"), dict):
                description = e["properties"].get("description")
            if isinstance(e.get("glossaryTermInfo"), dict):
                description = e["glossaryTermInfo"].get("description")
            results.append(DataHubSearchResult(urn=urn, type=etype, name=name, platform=platform, description=description))
        return results

    # ---------------- Dataset metadata ----------------

    def get_dataset_tags(self, dataset_urn: str) -> List[Dict[str, Any]]:
        gql = """
        query getTags($urn: String!) {
          dataset(urn: $urn) {
            tags {
              tags {
                tag {
                  name
                  urn
                  properties {
                    description
                    colorHex
                  }
                }
              }
            }
          }
        }
        """
        data = self.execute(gql, variables={"urn": dataset_urn})
        tags = []
        ds = (data.get("dataset") or {})
        for t in (((ds.get("tags") or {}).get("tags")) or []):
            tag = ((t or {}).get("tag") or {})
            if tag.get("urn"):
                tags.append(tag)
        return tags

    def get_dataset_terms(self, dataset_urn: str) -> List[Dict[str, Any]]:
        gql = """
        query getTerms($urn: String!) {
          dataset(urn: $urn) {
            glossaryTerms {
              terms {
                term {
                  urn
                  glossaryTermInfo {
                    name
                    description
                  }
                }
              }
            }
          }
        }
        """
        data = self.execute(gql, variables={"urn": dataset_urn})
        terms = []
        ds = (data.get("dataset") or {})
        for t in (((ds.get("glossaryTerms") or {}).get("terms")) or []):
            term = ((t or {}).get("term") or {})
            if term.get("urn"):
                terms.append(term)
        return terms

    # ---------------- Mutations ----------------

    def create_tag(self, name: str, tag_id: str, description: str | None = None) -> str:
        gql = """
        mutation createTag($name: String!, $id: String!, $description: String) {
          createTag(input: { name: $name, id: $id, description: $description })
        }
        """
        data = self.execute(gql, variables={"name": name, "id": tag_id, "description": description})
        return data.get("createTag")

    def create_glossary_term(self, name: str, term_id: str, description: str | None = None) -> str:
        gql = """
        mutation createGlossaryTerm($name: String!, $id: String!, $description: String) {
          createGlossaryTerm(input: { name: $name, id: $id, description: $description })
        }
        """
        data = self.execute(gql, variables={"name": name, "id": term_id, "description": description})
        return data.get("createGlossaryTerm")

    def add_tags(self, resource_urn: str, tag_urns: List[str]) -> bool:
        gql = """
        mutation addTags($resourceUrn: String!, $tagUrns: [String!]!) {
          addTags(input: { resourceUrn: $resourceUrn, tagUrns: $tagUrns })
        }
        """
        data = self.execute(gql, variables={"resourceUrn": resource_urn, "tagUrns": tag_urns})
        return bool(data.get("addTags"))

    def add_terms(self, resource_urn: str, term_urns: List[str]) -> bool:
        gql = """
        mutation addTerms($resourceUrn: String!, $termUrns: [String!]!) {
          addTerms(input: { resourceUrn: $resourceUrn, termUrns: $termUrns })
        }
        """
        data = self.execute(gql, variables={"resourceUrn": resource_urn, "termUrns": term_urns})
        return bool(data.get("addTerms"))
