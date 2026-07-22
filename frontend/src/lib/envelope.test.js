import { describe, expect, it } from "vitest";
import {
  envelopeData,
  envelopeHydrating,
  envelopeMeta,
  envelopeNonAuthoritative,
  envelopeState,
  envelopeStatus,
  envelopeWarnings,
} from "./envelope";

// Recorded payload fixtures — each mirrors a real backend envelope shape the
// product has served (see lib/api.js request() and the FRONTEND_BLUEPRINT §3
// inventory). The status table below is the contract every surface renders.
const FIXTURES = {
  loadingEnvelope: {
    data: { kpis: [] },
    meta: { state: "loading", warnings: [] },
  },
  hydratingCapabilities: {
    data: { assets: [] },
    meta: { state: "available", capabilities: { hydrating: true } },
  },
  inventoryHydrating: {
    // Discovery search while the inventory cache warms.
    assets: [],
    count: 0,
    meta: { state: "available", inventoryHydrating: true },
  },
  discoveryStateLoading: {
    // Legacy location: discovery envelopes carried meta.discoveryState.
    assets: [],
    meta: { discoveryState: "loading" },
  },
  flatHydratingFlag: {
    // Asset-detail flat flag (`payload.hydrating === true`).
    fqn: "main.sales.orders",
    hydrating: true,
    loadedSections: ["header"],
  },
  queryStateLoading: {
    // Discovery query-validation state location.
    assets: [],
    queryState: { state: "loading" },
  },
  available: {
    data: { rows: [1, 2, 3] },
    meta: { state: "available", warnings: [] },
  },
  liveLineage: {
    fqn: "main.sales.orders",
    meta: { state: "live", source: "unity-catalog-lineage", authoritative: true },
    graphs: { data: { nodes: [{ id: "focus" }], edges: [] } },
  },
  degraded: {
    data: { rows: [1] },
    meta: { state: "degraded", warnings: ["Query timed out; serving cache."] },
  },
  unavailable: {
    data: null,
    meta: { state: "unavailable", warnings: ["Lineage tables not readable."] },
  },
  errorState: {
    data: null,
    meta: { state: "error", warnings: ["Upstream 502"] },
  },
  nonAuthoritativeState: {
    data: { assets: [{ fqn: "mock.a.b" }] },
    meta: { state: "non_authoritative", warnings: ["Non-authoritative payload rejected."] },
  },
  prototypeMockState: {
    assets: [{ fqn: "mock.a.b" }],
    meta: { state: "prototype_mock" },
  },
  nonAuthoritativeFlag: {
    data: { assets: [] },
    nonAuthoritative: true,
    meta: { state: "available" },
  },
  mockSource: {
    data: { assets: [] },
    meta: { state: "available", source: "local-prototype-mock" },
  },
  // authoritative:false alone is a trusted degraded/workspace-scoped live
  // envelope — provisional data, NOT non-authoritative (lineage P0 class).
  authoritativeFalseOnly: {
    fqn: "main.sales.orders",
    authoritative: false,
    meta: {
      state: "live",
      source: "unity-catalog-lineage",
      visibilityScope: "workspace-app-principal",
      authoritative: false,
    },
    graphs: { data: { nodes: [{ id: "n" }], edges: [] } },
  },
};

describe("envelopeStatus (table-driven over recorded fixtures)", () => {
  const TABLE = [
    // [label, payload, context, expected]
    ["null payload without seed", null, {}, "loading"],
    ["null payload with seed", null, { hasSeed: true }, "hydrating"],
    ["undefined payload with seed", undefined, { hasSeed: true }, "hydrating"],
    ["loading envelope", FIXTURES.loadingEnvelope, {}, "hydrating"],
    ["capabilities.hydrating", FIXTURES.hydratingCapabilities, {}, "hydrating"],
    ["inventoryHydrating", FIXTURES.inventoryHydrating, {}, "hydrating"],
    ["legacy meta.discoveryState loading", FIXTURES.discoveryStateLoading, {}, "hydrating"],
    ["flat payload.hydrating flag", FIXTURES.flatHydratingFlag, {}, "hydrating"],
    ["legacy queryState.state loading", FIXTURES.queryStateLoading, {}, "hydrating"],
    ["available envelope", FIXTURES.available, {}, "available"],
    ["live lineage envelope", FIXTURES.liveLineage, {}, "available"],
    ["degraded envelope", FIXTURES.degraded, {}, "degraded"],
    ["unavailable envelope", FIXTURES.unavailable, {}, "unavailable"],
    ["error-state envelope", FIXTURES.errorState, {}, "unavailable"],
    ["non_authoritative state", FIXTURES.nonAuthoritativeState, {}, "unavailable"],
    ["prototype_mock state", FIXTURES.prototypeMockState, {}, "unavailable"],
    ["nonAuthoritative flag", FIXTURES.nonAuthoritativeFlag, {}, "unavailable"],
    ["local-prototype-mock source", FIXTURES.mockSource, {}, "unavailable"],
    // Refresh-failure-over-data degrades, never wipes.
    ["available + refresh error", FIXTURES.available, { refreshError: "boom" }, "degraded"],
    ["available + refresh Error object", FIXTURES.available, { refreshError: new Error("x") }, "degraded"],
    // Hydration outranks refresh errors (still building → keep shimmering).
    ["loading + refresh error", FIXTURES.loadingEnvelope, { refreshError: "boom" }, "hydrating"],
    // Caller-computed deep heuristic verdict wins.
    ["available + caller nonAuthoritative", FIXTURES.available, { nonAuthoritative: true }, "unavailable"],
    // authoritative:false alone is provisional-but-renderable, not unavailable.
    ["authoritative:false trusted live envelope", FIXTURES.authoritativeFalseOnly, {}, "available"],
  ];

  it.each(TABLE)("%s → %s", (label, payload, context, expected) => {
    expect(envelopeStatus(payload, context)).toBe(expected);
  });
});

describe("envelopeHydrating", () => {
  it("is a superset of every legacy predicate it replaced", () => {
    expect(envelopeHydrating(FIXTURES.loadingEnvelope)).toBe(true);
    expect(envelopeHydrating(FIXTURES.hydratingCapabilities)).toBe(true);
    expect(envelopeHydrating(FIXTURES.inventoryHydrating)).toBe(true);
    expect(envelopeHydrating(FIXTURES.discoveryStateLoading)).toBe(true);
    expect(envelopeHydrating(FIXTURES.flatHydratingFlag)).toBe(true);
    expect(envelopeHydrating(FIXTURES.queryStateLoading)).toBe(true);
    expect(envelopeHydrating({ meta: { state: "hydrating" } })).toBe(true);
  });

  it("is false for terminal envelopes and non-objects", () => {
    expect(envelopeHydrating(FIXTURES.available)).toBe(false);
    expect(envelopeHydrating(FIXTURES.degraded)).toBe(false);
    expect(envelopeHydrating(FIXTURES.unavailable)).toBe(false);
    expect(envelopeHydrating(null)).toBe(false);
    expect(envelopeHydrating(undefined)).toBe(false);
    expect(envelopeHydrating("loading")).toBe(false);
    expect(envelopeHydrating([{ meta: { state: "loading" } }])).toBe(false);
  });
});

describe("envelope accessors", () => {
  it("envelopeData unwraps {data} envelopes and passes flat payloads through", () => {
    expect(envelopeData(FIXTURES.available)).toEqual({ rows: [1, 2, 3] });
    expect(envelopeData(FIXTURES.flatHydratingFlag)).toBe(FIXTURES.flatHydratingFlag);
    expect(envelopeData(null)).toBe(null);
  });

  it("envelopeMeta always returns an object", () => {
    expect(envelopeMeta(FIXTURES.available).state).toBe("available");
    expect(envelopeMeta({})).toEqual({});
    expect(envelopeMeta(null)).toEqual({});
  });

  it("envelopeState resolves every legacy state location, lowercased", () => {
    expect(envelopeState({ meta: { state: "LOADING" } })).toBe("loading");
    expect(envelopeState(FIXTURES.discoveryStateLoading)).toBe("loading");
    expect(envelopeState({ state: "degraded" })).toBe("degraded");
    expect(envelopeState(FIXTURES.queryStateLoading)).toBe("loading");
    expect(envelopeState(null)).toBe("");
  });

  it("envelopeWarnings merges meta + top-level warnings, deduplicated", () => {
    expect(
      envelopeWarnings({
        warnings: ["a", "b", ""],
        meta: { warnings: ["b", "c"] },
      }),
    ).toEqual(["b", "c", "a"]);
    expect(envelopeWarnings(null)).toEqual([]);
  });

  it("envelopeNonAuthoritative requires an explicit marker", () => {
    expect(envelopeNonAuthoritative(FIXTURES.nonAuthoritativeState)).toBe(true);
    expect(envelopeNonAuthoritative(FIXTURES.mockSource)).toBe(true);
    expect(envelopeNonAuthoritative(FIXTURES.authoritativeFalseOnly)).toBe(false);
    expect(envelopeNonAuthoritative(FIXTURES.available)).toBe(false);
  });
});
