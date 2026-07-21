/*
 * legacyAdapters tests — the drilled-callback bridge must translate every
 * legacy surface intent to the canonical routes (Wave B1 adapter inventory).
 */

import { render } from "@testing-library/react";
import { act } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import {
  LEGACY_MODULE_TARGETS,
  compactDiscoveryFilterGroups,
  useLegacyNavAdapters,
} from "../legacyAdapters.js";
import { peekWorkspaceIntent } from "../../lib/workspaceIntent";

let adapters = null;
let location = null;

function Harness() {
  adapters = useLegacyNavAdapters();
  location = useLocation();
  return null;
}

function mountHarness(initialEntry = "/home") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Harness />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  adapters = null;
  location = null;
  window.sessionStorage.clear();
});

describe("compactDiscoveryFilterGroups", () => {
  it("drops empty groups and de-duplicates values", () => {
    expect(
      compactDiscoveryFilterGroups({ domains: ["Customer", "Customer", " "], tiers: [] }),
    ).toEqual({ domains: ["Customer"] });
  });

  it("returns null when nothing survives", () => {
    expect(compactDiscoveryFilterGroups({ tiers: [] })).toBeNull();
    expect(compactDiscoveryFilterGroups()).toBeNull();
  });
});

describe("LEGACY_MODULE_TARGETS", () => {
  it("maps every absorbed legacy module to its canonical surface", () => {
    expect(LEGACY_MODULE_TARGETS.inbox).toEqual({ surface: "stewardship", params: { assignee: "me" } });
    expect(LEGACY_MODULE_TARGETS.cde).toEqual({ surface: "glossary", params: { tab: "cdes" } });
    expect(LEGACY_MODULE_TARGETS.capabilities).toEqual({ surface: "admin", params: { tab: "diagnostics" } });
    expect(LEGACY_MODULE_TARGETS.insights).toEqual({ surface: "home" });
    expect(LEGACY_MODULE_TARGETS.governance).toEqual({ surface: "stewardship" });
    expect(LEGACY_MODULE_TARGETS.audit).toEqual({ surface: "evidence" });
    expect(LEGACY_MODULE_TARGETS.taxonomy).toEqual({ surface: "glossary" });
  });
});

describe("useLegacyNavAdapters", () => {
  it("onOpenAsset navigates to the hub and stages the legacy tab intent", () => {
    mountHarness("/discovery");
    act(() => adapters.onOpenAsset("main.core.orders", "Schema"));
    expect(location.pathname).toBe("/assets/main.core.orders");
    // Parity with openEntityWorkspace: intent staged from the SOURCE path.
    expect(peekWorkspaceIntent("entityTab", "main.core.orders", "")).toBe("Schema");
  });

  it("onOpenLineage navigates to the focused graph and stages context", () => {
    mountHarness("/home");
    act(() => adapters.onOpenLineage("main.core.orders", "Operational Context"));
    expect(location.pathname).toBe("/lineage/main.core.orders");
    expect(peekWorkspaceIntent("lineageContext", "main.core.orders", "")).toBe("Operational Context");
  });

  it("onOpenLineage without an asset lands on the search-first picker", () => {
    mountHarness("/home");
    act(() => adapters.onOpenLineage(""));
    expect(location.pathname).toBe("/lineage");
  });

  it("onOpenGovernance carries the asset scope", () => {
    mountHarness("/home");
    act(() => adapters.onOpenGovernance("main.core.orders"));
    expect(location.pathname).toBe("/stewardship");
    expect(new URLSearchParams(location.search).get("asset")).toBe("main.core.orders");
  });

  it("onOpenDiscoveryWithFilter serializes the legacy filters grammar and marks the entry fresh", () => {
    mountHarness("/home");
    act(() =>
      adapters.onOpenDiscoveryWithFilter({ domains: ["Customer"] }, "churn", { sortBy: "name" }),
    );
    expect(location.pathname).toBe("/discovery");
    const params = new URLSearchParams(location.search);
    expect(params.get("q")).toBe("churn");
    expect(params.get("sort")).toBe("name");
    expect(JSON.parse(params.get("filters"))).toEqual({ domains: ["Customer"] });
    expect(location.state).toEqual({ fresh: true });
  });

  it("onNavigate translates legacy module keys", () => {
    mountHarness("/home");
    act(() => adapters.onNavigate("capabilities"));
    expect(location.pathname).toBe("/admin");
    expect(new URLSearchParams(location.search).get("tab")).toBe("diagnostics");
    act(() => adapters.onNavigate("inbox"));
    expect(location.pathname).toBe("/stewardship");
    expect(new URLSearchParams(location.search).get("assignee")).toBe("me");
  });

  it("onOpenGlossaryTerm links to the durable term path", () => {
    mountHarness("/home");
    act(() => adapters.onOpenGlossaryTerm("Churn Rate"));
    expect(location.pathname).toBe("/glossary/Churn%20Rate");
  });
});
