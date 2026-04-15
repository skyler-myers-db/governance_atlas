import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useAppRouteState } from "./useAppRouteState";

function RouteHarness() {
  const route = useAppRouteState();
  const location = useLocation();

  return (
    <div>
      <div data-testid="surface">{route.surface}</div>
      <div data-testid="asset">{route.routeAssetFqn}</div>
      <div data-testid="query">{route.discoveryRouteState.query}</div>
      <div data-testid="path">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
      <button onClick={() => route.openLineageWorkspace("")} type="button">
        Clear Lineage
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
      expect(screen.getByTestId("path").textContent).toBe("/discovery");
      expect(screen.getByTestId("search").textContent).toBe("?q=finance");
    });
  });

  it("preserves explicit glossary routes instead of canonicalizing them back to /governance", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/glossary/core/terms/customer"]}
      >
        <RouteHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface").textContent).toBe("governance");
      expect(screen.getByTestId("path").textContent).toBe("/glossary/core/terms/customer");
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
});
