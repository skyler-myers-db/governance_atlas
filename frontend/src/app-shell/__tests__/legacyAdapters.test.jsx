/*
 * legacyAdapters tests — the surviving shell bridge (Wave C8): module-key →
 * surface ref translation plus the discovery opener that carries the
 * `location.state.fresh` flag. The per-entity adapters and workspaceIntent
 * staging were deleted with their last consumers.
 */

import { render } from "@testing-library/react";
import { act } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { LEGACY_MODULE_TARGETS, useLegacyNavAdapters } from "../legacyAdapters.js";

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
  it("onNavigate translates legacy module keys", () => {
    mountHarness("/home");
    act(() => adapters.onNavigate("capabilities"));
    expect(location.pathname).toBe("/admin");
    expect(new URLSearchParams(location.search).get("tab")).toBe("diagnostics");
    act(() => adapters.onNavigate("inbox"));
    expect(location.pathname).toBe("/stewardship");
    expect(new URLSearchParams(location.search).get("assignee")).toBe("me");
  });

  it("openDiscovery marks the entry fresh and carries params", () => {
    mountHarness("/home");
    act(() => adapters.openDiscovery({ q: "churn" }, { fresh: true }));
    expect(location.pathname).toBe("/discovery");
    expect(new URLSearchParams(location.search).get("q")).toBe("churn");
    expect(location.state).toEqual({ fresh: true });
  });

  it("navigate resolves entity refs to durable addresses", () => {
    mountHarness("/home");
    act(() => adapters.navigate({ kind: "asset", fqn: "main.core.orders" }));
    expect(location.pathname).toBe("/assets/main.core.orders");
  });
});
