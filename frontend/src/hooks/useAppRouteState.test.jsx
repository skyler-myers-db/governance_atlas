import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { useAppRouteState } from "./useAppRouteState";

function RouteHarness() {
  const route = useAppRouteState();
  const location = useLocation();

  return (
    <div>
      <div data-testid="surface">{route.surface}</div>
      <div data-testid="asset">{route.routeAssetFqn}</div>
      <div data-testid="query">{route.discoveryRouteState.query}</div>
      <div data-testid="preview">{route.discoveryRouteState.previewAssetFqn}</div>
      <div data-testid="sort">{route.discoveryRouteState.sortBy}</div>
      <div data-testid="views">{(route.discoveryRouteState.views || []).join("|")}</div>
      <div data-testid="filters">{JSON.stringify(route.discoveryRouteState.filterGroups || {})}</div>
      <div data-testid="path">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
      <div data-testid="fresh">{String(Boolean(location.state?.fresh))}</div>
      <button onClick={() => route.openEntityWorkspace("main.sales.orders")} type="button">
        Open Entity
      </button>
      <button onClick={() => route.openLineageWorkspace("main.sales.orders")} type="button">
        Open Lineage
      </button>
      <button onClick={() => route.openGovernanceWorkspace("main.sales.orders")} type="button">
        Open Governance
      </button>
      <button onClick={() => route.openDiscoveryWorkspace(route.discoveryRouteState.query, { fresh: false })} type="button">
        Open Discovery
      </button>
      <button onClick={() => route.openDiscoveryWorkspace(route.discoveryRouteState.query, { fresh: true })} type="button">
        Fresh Discovery
      </button>
      <button onClick={() => route.onModuleChange("discovery")} type="button">
        Module Discovery
      </button>
      <button onClick={() => route.onModuleChange("admin")} type="button">
        Module Admin
      </button>
      <button onClick={() => route.openLineageWorkspace("")} type="button">
        Clear Lineage
      </button>
    </div>
  );
}

function QueryHistoryHarness() {
  const route = useAppRouteState();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div>
      <div data-testid="surface">{route.surface}</div>
      <div data-testid="query">{route.discoveryRouteState.query}</div>
      <div data-testid="preview">{route.discoveryRouteState.previewAssetFqn}</div>
      <div data-testid="sort">{route.discoveryRouteState.sortBy}</div>
      <div data-testid="views">{(route.discoveryRouteState.views || []).join("|")}</div>
      <div data-testid="filters">{JSON.stringify(route.discoveryRouteState.filterGroups || {})}</div>
      <div data-testid="path">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
      <div data-testid="fresh">{String(Boolean(location.state?.fresh))}</div>
      <button onClick={() => route.setDiscoveryRouteQuery("orders")} type="button">
        Replace Orders
      </button>
      <button onClick={() => route.setDiscoveryRouteQuery("customers")} type="button">
        Replace Customers
      </button>
      <button onClick={() => route.setDiscoveryRouteQuery("orders", { replace: false, fresh: true })} type="button">
        Push Orders
      </button>
      <button onClick={() => route.setDiscoveryRouteSort("Recently updated")} type="button">
        Replace Sort
      </button>
      <button onClick={() => route.setDiscoveryRouteSort("Recently updated", { replace: false, fresh: true })} type="button">
        Push Sort
      </button>
      <button onClick={() => route.setDiscoveryRoutePreview("main.sales.returns")} type="button">
        Replace Preview
      </button>
      <button onClick={() => route.setDiscoveryRoutePreview("main.sales.returns", { replace: false, fresh: true })} type="button">
        Push Preview
      </button>
      <button onClick={() => route.setDiscoveryRouteViews(["Needs review"])} type="button">
        Replace View
      </button>
      <button onClick={() => route.setDiscoveryRouteViews(["Needs review"], { replace: false, fresh: true })} type="button">
        Push View
      </button>
      <button onClick={() => route.setDiscoveryRouteFilterGroups({ types: ["Table"], catalogs: ["main"] })} type="button">
        Replace Filters
      </button>
      <button
        onClick={() =>
          route.setDiscoveryRouteFilterGroups(
            { types: ["Table"], catalogs: ["main"] },
            { replace: false, fresh: true },
          )}
        type="button"
      >
        Push Filters
      </button>
      <button onClick={() => navigate(-1)} type="button">
        Back
      </button>
      <button onClick={() => navigate(1)} type="button">
        Forward
      </button>
    </div>
  );
}

describe("useAppRouteState", () => {
  it("canonicalizes legacy lineage URLs into router-owned canonical paths", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/?module=lineage&asset=main.sales.orders"]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("lineage");
      expect(screen.getByTestId("asset").textContent).toBe("main.sales.orders");
      expect(screen.getByTestId("path").textContent).toBe("/lineage/main.sales.orders");
      expect(screen.getByTestId("search").textContent).toBe("");
    });
  });

  it("preserves discovery queries on canonical discovery routes", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/?module=discovery&q=finance"]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("discovery");
      expect(screen.getByTestId("query").textContent).toBe("finance");
      expect(screen.getByTestId("sort").textContent).toBe("");
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(screen.getByTestId("search").textContent).toBe("?q=finance");
    });
  });

  it("canonicalizes prototype route aliases to the production surfaces", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/lineage-atlas/main.sales.orders"]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("lineage");
      expect(screen.getByTestId("asset").textContent).toBe("main.sales.orders");
      expect(screen.getByTestId("path").textContent).toBe("/lineage/main.sales.orders");
    });
  });

  it.each([
    ["/command-center", "home", "/home"],
    ["/discover", "discovery", "/discovery"],
    ["/stewardship", "governance", "/governance"],
    ["/glossary", "taxonomy", "/taxonomy"],
    ["/glossary-cdes", "taxonomy", "/taxonomy"],
    ["/audit-evidence", "audit", "/audit"],
    ["/control-center", "admin", "/admin"],
  ])("canonicalizes %s to %s", async (entry, surface, path) => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={[entry]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe(surface);
      expect(screen.getByTestId("path").textContent).toBe(path);
    });
  });

  it("canonicalizes admin routes from path and module navigation", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/?module=admin"]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("admin");
      expect(screen.getByTestId("path").textContent).toBe("/admin");
    });

    fireEvent.click(screen.getByRole("button", { name: "Module Discovery" }));
    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("discovery");
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
    });

    fireEvent.click(screen.getByRole("button", { name: "Module Admin" }));
    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("admin");
      expect(screen.getByTestId("path").textContent).toBe("/admin");
    });
  });

  it("keeps blank discovery routes previewless until selection is explicit", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/discovery"]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("discovery");
      expect(screen.getByTestId("preview").textContent).toBe("");
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(screen.getByTestId("search").textContent).toBe("");
    });
  });

  it("parses discovery sort from canonical discovery routes", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/discovery?q=finance&sort=Recently+updated"]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("discovery");
      expect(screen.getByTestId("query").textContent).toBe("finance");
      expect(screen.getByTestId("sort").textContent).toBe("Recently updated");
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      const search = screen.getByTestId("search").textContent || "";
      expect(search).toContain("q=finance");
      expect(search).toContain("sort=Recently+updated");
    });
  });

  it("parses discovery preview from canonical discovery routes", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/discovery?q=finance&preview=main.sales.returns"]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("discovery");
      expect(screen.getByTestId("query").textContent).toBe("finance");
      expect(screen.getByTestId("preview").textContent).toBe("main.sales.returns");
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      const search = screen.getByTestId("search").textContent || "";
      expect(search).toContain("q=finance");
      expect(search).toContain("preview=main.sales.returns");
    });
  });

  it("parses discovery saved views from canonical discovery routes", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/discovery?q=finance&views=Needs+review"]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("discovery");
      expect(screen.getByTestId("query").textContent).toBe("finance");
      expect(screen.getByTestId("views").textContent).toBe("Needs review");
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      const search = screen.getByTestId("search").textContent || "";
      expect(search).toContain("q=finance");
      expect(search).toContain("views=Needs+review");
    });
  });

  it("parses grouped discovery filters from canonical discovery routes", async () => {
    const filterGroups = encodeURIComponent(JSON.stringify({
      types: ["Table"],
      catalogs: ["main"],
      domains: ["Finance"],
    }));
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={[`/discovery?q=finance&filters=${filterGroups}`]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("discovery");
      expect(screen.getByTestId("query").textContent).toBe("finance");
      expect(screen.getByTestId("filters").textContent).toBe(
        JSON.stringify({
          types: ["Table"],
          catalogs: ["main"],
          domains: ["Finance"],
          tiers: [],
          certifications: [],
          sensitivities: [],
        }),
      );
      const search = screen.getByTestId("search").textContent || "";
      expect(search).toContain("q=finance");
      expect(search).toContain("filters=");
    });
  });

  it("strips deferred discovery filter params while preserving the owned route contract", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={[
          "/discovery?q=finance&sort=Recently+updated&preview=main.sales.returns&views=Needs+review&types=Table&type=View&catalogs=main&domains=Finance&tiers=Gold&certifications=Certified&sensitivities=PII",
        ]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("discovery");
      expect(screen.getByTestId("query").textContent).toBe("finance");
      expect(screen.getByTestId("sort").textContent).toBe("Recently updated");
      expect(screen.getByTestId("preview").textContent).toBe("main.sales.returns");
      expect(screen.getByTestId("views").textContent).toBe("Needs review");
      const search = screen.getByTestId("search").textContent || "";
      expect(search).toContain("q=finance");
      expect(search).toContain("sort=Recently+updated");
      expect(search).toContain("preview=main.sales.returns");
      expect(search).toContain("views=Needs+review");
      expect(search).not.toContain("types=");
      expect(search).not.toContain("type=");
      expect(search).not.toContain("catalogs=");
      expect(search).not.toContain("domains=");
      expect(search).not.toContain("tiers=");
      expect(search).not.toContain("certifications=");
      expect(search).not.toContain("sensitivities=");
    });
  });

  it("strips deferred discovery filter params from canonical non-discovery routes too", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={[
          "/entity/main.sales.orders?q=finance&sort=Recently+updated&preview=main.sales.returns&views=Needs+review&types=Table&catalogs=main",
        ]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("entity");
      expect(screen.getByTestId("path").textContent).toBe("/entity/main.sales.orders");
      const search = screen.getByTestId("search").textContent || "";
      expect(search).toContain("q=finance");
      expect(search).toContain("sort=Recently+updated");
      expect(search).toContain("preview=main.sales.returns");
      expect(search).toContain("views=Needs+review");
      expect(search).not.toContain("types=");
      expect(search).not.toContain("catalogs=");
    });
  });

  it("routes glossary paths to the Glossary & CDEs workspace", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/glossary/core/terms/customer"]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("taxonomy");
      expect(screen.getByTestId("path").textContent).toBe("/taxonomy");
    });
  });

  it("treats an explicit empty lineage target as a real clear-focus navigation", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/lineage/main.sales.orders"]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear Lineage" }));

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("lineage");
      expect(screen.getByTestId("asset").textContent).toBe("");
      expect(screen.getByTestId("path").textContent).toBe("/lineage");
      expect(screen.getByTestId("search").textContent).toBe("");
    });
  });

  it("preserves discovery query context when roundtripping through entity routes", async () => {
    const filterGroups = encodeURIComponent(JSON.stringify({
      types: ["Table"],
      catalogs: ["main"],
    }));
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={[`/discovery?q=finance&sort=Recently+updated&preview=main.sales.returns&views=Needs+review&filters=${filterGroups}`]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Entity" }));

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("entity");
      expect(screen.getByTestId("path").textContent).toBe("/entity/main.sales.orders");
      const search = screen.getByTestId("search").textContent || "";
      expect(search).toContain("q=finance");
      expect(search).toContain("sort=Recently+updated");
      expect(search).toContain("preview=main.sales.returns");
      expect(search).toContain("views=Needs+review");
      expect(search).toContain("filters=");
      expect(screen.getByTestId("query").textContent).toBe("finance");
      expect(screen.getByTestId("preview").textContent).toBe("main.sales.returns");
      expect(screen.getByTestId("sort").textContent).toBe("Recently updated");
      expect(screen.getByTestId("views").textContent).toBe("Needs review");
      expect(screen.getByTestId("filters").textContent).toBe(
        JSON.stringify({
          types: ["Table"],
          catalogs: ["main"],
          domains: [],
          tiers: [],
          certifications: [],
          sensitivities: [],
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Discovery" }));

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("discovery");
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      const search = screen.getByTestId("search").textContent || "";
      expect(search).toContain("q=finance");
      expect(search).toContain("sort=Recently+updated");
      expect(search).toContain("preview=main.sales.returns");
      expect(search).toContain("views=Needs+review");
      expect(search).toContain("filters=");
      expect(screen.getByTestId("query").textContent).toBe("finance");
      expect(screen.getByTestId("preview").textContent).toBe("main.sales.returns");
      expect(screen.getByTestId("sort").textContent).toBe("Recently updated");
      expect(screen.getByTestId("views").textContent).toBe("Needs review");
      expect(screen.getByTestId("filters").textContent).toBe(
        JSON.stringify({
          types: ["Table"],
          catalogs: ["main"],
          domains: [],
          tiers: [],
          certifications: [],
          sensitivities: [],
        }),
      );
    });
  });

  it("clears preview and saved-view route state on fresh discovery opens while preserving query and sort", async () => {
    const filterGroups = encodeURIComponent(JSON.stringify({
      types: ["Table"],
      catalogs: ["main"],
    }));
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={[`/entity/main.sales.orders?q=finance&sort=Recently+updated&preview=main.sales.returns&views=Needs+review&filters=${filterGroups}`]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Fresh Discovery" }));

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("discovery");
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      const search = screen.getByTestId("search").textContent || "";
      expect(search).toContain("q=finance");
      expect(search).toContain("sort=Recently+updated");
      expect(search).not.toContain("preview=");
      expect(search).not.toContain("views=");
      expect(search).not.toContain("filters=");
      expect(screen.getByTestId("query").textContent).toBe("finance");
      expect(screen.getByTestId("sort").textContent).toBe("Recently updated");
      expect(screen.getByTestId("preview").textContent).toBe("");
      expect(screen.getByTestId("views").textContent).toBe("");
      expect(screen.getByTestId("filters").textContent).toBe(
        JSON.stringify({
          types: [],
          catalogs: [],
          domains: [],
          tiers: [],
          certifications: [],
          sensitivities: [],
        }),
      );
    });
  });

  it("treats discovery module navigation as a fresh browse boundary", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/lineage/main.sales.orders?q=finance&sort=Recently+updated&preview=main.sales.returns&views=Needs+review"]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Module Discovery" }));

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("discovery");
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      const search = screen.getByTestId("search").textContent || "";
      expect(search).toContain("q=finance");
      expect(search).toContain("sort=Recently+updated");
      expect(search).not.toContain("preview=");
      expect(search).not.toContain("views=");
      expect(screen.getByTestId("query").textContent).toBe("finance");
      expect(screen.getByTestId("sort").textContent).toBe("Recently updated");
      expect(screen.getByTestId("preview").textContent).toBe("");
      expect(screen.getByTestId("views").textContent).toBe("");
      expect(screen.getByTestId("fresh").textContent).toBe("true");
    });
  });

  it("preserves discovery query context across lineage and governance module switches", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/discovery?q=finance&sort=Recently+updated&preview=main.sales.returns&views=Needs+review"]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Lineage" }));

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("lineage");
      expect(screen.getByTestId("path").textContent).toBe("/lineage/main.sales.orders");
      const search = screen.getByTestId("search").textContent || "";
      expect(search).toContain("q=finance");
      expect(search).toContain("sort=Recently+updated");
      expect(search).toContain("preview=main.sales.returns");
      expect(screen.getByTestId("query").textContent).toBe("finance");
      expect(screen.getByTestId("preview").textContent).toBe("main.sales.returns");
      expect(screen.getByTestId("sort").textContent).toBe("Recently updated");
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Governance" }));

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("governance");
      expect(screen.getByTestId("path").textContent).toBe("/governance");
      const search = screen.getByTestId("search").textContent || "";
      expect(search).toContain("asset=main.sales.orders");
      expect(search).toContain("q=finance");
      expect(search).toContain("sort=Recently+updated");
      expect(search).toContain("preview=main.sales.returns");
      expect(search).toContain("views=Needs+review");
      expect(screen.getByTestId("query").textContent).toBe("finance");
      expect(screen.getByTestId("preview").textContent).toBe("main.sales.returns");
      expect(screen.getByTestId("sort").textContent).toBe("Recently updated");
      expect(screen.getByTestId("views").textContent).toBe("Needs review");
    });
  });

  it("replaces live discovery query refinements instead of creating a history entry per edit", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/governance", "/discovery?q=finance"]}
        initialIndex={1}
      >
        <QueryHistoryHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace Orders" }));

    await waitFor(() => {
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(screen.getByTestId("search").textContent).toBe("?q=orders");
      expect(screen.getByTestId("query").textContent).toBe("orders");
      expect(screen.getByTestId("fresh").textContent).toBe("false");
    });

    fireEvent.click(screen.getByRole("button", { name: "Replace Customers" }));

    await waitFor(() => {
      expect(screen.getByTestId("search").textContent).toBe("?q=customers");
      expect(screen.getByTestId("query").textContent).toBe("customers");
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(screen.getByTestId("path").textContent).toBe("/governance");
      expect(screen.getByTestId("search").textContent).toBe("");
      expect(screen.getByTestId("surface").textContent).toBe("governance");
    });

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    await waitFor(() => {
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(screen.getByTestId("search").textContent).toBe("?q=customers");
      expect(screen.getByTestId("query").textContent).toBe("customers");
    });
  });

  it("still supports explicit push semantics for fresh discovery navigations", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/discovery?q=finance"]}
      >
        <QueryHistoryHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Push Orders" }));

    await waitFor(() => {
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(screen.getByTestId("search").textContent).toBe("?q=orders");
      expect(screen.getByTestId("query").textContent).toBe("orders");
      expect(screen.getByTestId("fresh").textContent).toBe("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(screen.getByTestId("search").textContent).toBe("?q=finance");
      expect(screen.getByTestId("query").textContent).toBe("finance");
    });
  });

  it("keeps sort refinements replace-by-default while allowing explicit push semantics", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/governance", "/discovery?q=finance&sort=Best+match"]}
        initialIndex={1}
      >
        <QueryHistoryHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace Sort" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(search).toContain("q=finance");
      expect(search).toContain("sort=Recently+updated");
      expect(screen.getByTestId("sort").textContent).toBe("Recently updated");
      expect(screen.getByTestId("fresh").textContent).toBe("false");
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(screen.getByTestId("path").textContent).toBe("/governance");
      expect(screen.getByTestId("search").textContent).toBe("");
    });

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(search).toContain("q=finance");
      expect(search).toContain("sort=Recently+updated");
      expect(screen.getByTestId("sort").textContent).toBe("Recently updated");
    });

    fireEvent.click(screen.getByRole("button", { name: "Push Sort" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(search).toContain("q=finance");
      expect(search).toContain("sort=Recently+updated");
      expect(screen.getByTestId("fresh").textContent).toBe("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(search).toContain("q=finance");
      expect(search).toContain("sort=Recently+updated");
      expect(screen.getByTestId("fresh").textContent).toBe("false");
    });
  });

  it("keeps a blank discovery route as one stable history boundary when sort is added", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/governance", "/discovery"]}
        initialIndex={1}
      >
        <QueryHistoryHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace Sort" }));

    await waitFor(() => {
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(screen.getByTestId("search").textContent).toBe("?sort=Recently+updated");
      expect(screen.getByTestId("preview").textContent).toBe("");
      expect(screen.getByTestId("sort").textContent).toBe("Recently updated");
      expect(screen.getByTestId("fresh").textContent).toBe("false");
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(screen.getByTestId("path").textContent).toBe("/governance");
      expect(screen.getByTestId("search").textContent).toBe("");
      expect(screen.getByTestId("surface").textContent).toBe("governance");
    });

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    await waitFor(() => {
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(screen.getByTestId("search").textContent).toBe("?sort=Recently+updated");
      expect(screen.getByTestId("preview").textContent).toBe("");
      expect(screen.getByTestId("sort").textContent).toBe("Recently updated");
    });
  });

  it("keeps preview refinements replace-by-default while allowing explicit push semantics", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/governance", "/discovery?q=finance"]}
        initialIndex={1}
      >
        <QueryHistoryHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace Preview" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(search).toContain("q=finance");
      expect(search).toContain("preview=main.sales.returns");
      expect(screen.getByTestId("preview").textContent).toBe("main.sales.returns");
      expect(screen.getByTestId("fresh").textContent).toBe("false");
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(screen.getByTestId("path").textContent).toBe("/governance");
      expect(screen.getByTestId("search").textContent).toBe("");
    });

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(search).toContain("q=finance");
      expect(search).toContain("preview=main.sales.returns");
      expect(screen.getByTestId("preview").textContent).toBe("main.sales.returns");
    });

    fireEvent.click(screen.getByRole("button", { name: "Push Preview" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(search).toContain("q=finance");
      expect(search).toContain("preview=main.sales.returns");
      expect(screen.getByTestId("fresh").textContent).toBe("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(search).toContain("q=finance");
      expect(search).toContain("preview=main.sales.returns");
      expect(screen.getByTestId("fresh").textContent).toBe("false");
    });
  });

  it("keeps saved view refinements replace-by-default while allowing explicit push semantics", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/governance", "/discovery?q=finance"]}
        initialIndex={1}
      >
        <QueryHistoryHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace View" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(search).toContain("q=finance");
      expect(search).toContain("views=Needs+review");
      expect(screen.getByTestId("views").textContent).toBe("Needs review");
      expect(screen.getByTestId("fresh").textContent).toBe("false");
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(screen.getByTestId("path").textContent).toBe("/governance");
      expect(screen.getByTestId("search").textContent).toBe("");
    });

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(search).toContain("q=finance");
      expect(search).toContain("views=Needs+review");
      expect(screen.getByTestId("views").textContent).toBe("Needs review");
    });

    fireEvent.click(screen.getByRole("button", { name: "Push View" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(search).toContain("q=finance");
      expect(search).toContain("views=Needs+review");
      expect(screen.getByTestId("fresh").textContent).toBe("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(search).toContain("q=finance");
      expect(search).toContain("views=Needs+review");
      expect(screen.getByTestId("fresh").textContent).toBe("false");
    });
  });

  it("keeps grouped filter refinements replace-by-default while allowing explicit push semantics", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/governance", "/discovery?q=finance"]}
        initialIndex={1}
      >
        <QueryHistoryHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace Filters" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(search).toContain("q=finance");
      expect(search).toContain("filters=");
      expect(screen.getByTestId("filters").textContent).toBe(
        JSON.stringify({
          types: ["Table"],
          catalogs: ["main"],
          domains: [],
          tiers: [],
          certifications: [],
          sensitivities: [],
        }),
      );
      expect(screen.getByTestId("fresh").textContent).toBe("false");
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(screen.getByTestId("path").textContent).toBe("/governance");
      expect(screen.getByTestId("search").textContent).toBe("");
    });

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(search).toContain("q=finance");
      expect(search).toContain("filters=");
      expect(screen.getByTestId("filters").textContent).toBe(
        JSON.stringify({
          types: ["Table"],
          catalogs: ["main"],
          domains: [],
          tiers: [],
          certifications: [],
          sensitivities: [],
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Push Filters" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(search).toContain("q=finance");
      expect(search).toContain("filters=");
      expect(screen.getByTestId("fresh").textContent).toBe("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      const search = screen.getByTestId("search").textContent || "";
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(search).toContain("q=finance");
      expect(search).toContain("filters=");
      expect(screen.getByTestId("fresh").textContent).toBe("false");
    });
  });
});
