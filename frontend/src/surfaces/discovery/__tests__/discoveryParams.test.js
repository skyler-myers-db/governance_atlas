import { describe, expect, it } from "vitest";
import {
  DISCOVERY_PARAMS_SCHEMA,
  clearedFacetParams,
  filtersFromParams,
  hasNonQueryFilters,
  normalizeLegacyDiscoverySearch,
} from "../discoveryParams";
import { parseSearch } from "../../../nav/routes";

describe("normalizeLegacyDiscoverySearch (the redirect-normalizer)", () => {
  it("rewrites ?filters= JSON + plural shortcuts + ?views= + ?preview= into flat params", () => {
    const next = normalizeLegacyDiscoverySearch(
      '?q=churn&filters={"tiers":["Gold"],"domains":["Finance"]}&domains=Customer&views=Certified&preview=main.core.orders',
    );
    expect(next).not.toBeNull();
    const params = new URLSearchParams(next);
    expect(params.get("q")).toBe("churn");
    expect(params.get("filters")).toBeNull();
    expect(params.getAll("tier")).toEqual(["Gold"]);
    // JSON groups and shortcut params merge (deduped) into one flat param.
    expect(params.getAll("domain").sort()).toEqual(["Customer", "Finance"]);
    expect(params.getAll("view")).toEqual(["Certified"]);
    // ?preview= promotes to the addressable ?peek= drawer binding.
    expect(params.get("peek")).toBe("main.core.orders");
    expect(params.get("preview")).toBeNull();
  });

  it("keeps an explicit ?peek= over a legacy ?preview=", () => {
    const next = normalizeLegacyDiscoverySearch("?preview=a.b.c&peek=x.y.z");
    const params = new URLSearchParams(next);
    expect(params.get("peek")).toBe("x.y.z");
  });

  it("drops 'All …' sentinels and malformed filter JSON instead of throwing", () => {
    const next = normalizeLegacyDiscoverySearch('?filters={"domains":["All domains","Sales"]}');
    const params = new URLSearchParams(next);
    expect(params.getAll("domain")).toEqual(["Sales"]);
    expect(normalizeLegacyDiscoverySearch("?filters={broken")).toBe("");
  });

  it("returns null for already-canonical URLs (no redirect loop)", () => {
    expect(normalizeLegacyDiscoverySearch("?q=churn&domain=Finance&peek=a.b.c")).toBeNull();
    expect(normalizeLegacyDiscoverySearch("")).toBeNull();
  });
});

describe("filtersFromParams", () => {
  const bootstrap = {
    discovery: {
      sortOptions: ["Best match", "Coverage score"],
      views: ["All assets", "Certified", "Needs owner"],
    },
  };

  it("maps flat params to the grouped search-request shape", () => {
    const params = parseSearch(
      DISCOVERY_PARAMS_SCHEMA,
      "?q=revenue&sort=Coverage%20score&domain=Finance&tier=Gold&view=Certified&cde=1",
    );
    const filters = filtersFromParams(params, bootstrap);
    expect(filters.query).toBe("revenue");
    expect(filters.sortBy).toBe("Coverage score");
    expect(filters.domains).toEqual(["Finance"]);
    expect(filters.tiers).toEqual(["Gold"]);
    expect(filters.views).toEqual(["Certified"]);
    expect(filters.cdeOnly).toBe(true);
    expect(hasNonQueryFilters(filters)).toBe(true);
  });

  it("falls back to the bootstrap default sort for unknown sort values", () => {
    const params = parseSearch(DISCOVERY_PARAMS_SCHEMA, "?sort=Bogus");
    expect(filtersFromParams(params, bootstrap).sortBy).toBe("Best match");
  });

  it("drops saved views the bootstrap does not declare", () => {
    const params = parseSearch(DISCOVERY_PARAMS_SCHEMA, "?view=Certified&view=Bogus");
    expect(filtersFromParams(params, bootstrap).views).toEqual(["Certified"]);
  });

  it("clearedFacetParams empties every facet param in one patch", () => {
    const cleared = clearedFacetParams();
    expect(cleared.q).toBe("");
    expect(cleared.domain).toEqual([]);
    expect(cleared.cde).toBe(false);
    expect(cleared.owner).toBe("");
  });
});
