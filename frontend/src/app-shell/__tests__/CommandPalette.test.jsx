/*
 * Unified palette tests (Wave B1) — replaces the legacy
 * primitives/CommandPalette tests. Asserts route-table-driven jump rows,
 * live search rows via usePaletteSearch, real anchor hrefs, and the
 * "Search Discover" escape hatch.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const usePaletteSearchMock = vi.fn();
vi.mock("../../hooks/usePaletteSearch", () => ({
  usePaletteSearch: (...args) => usePaletteSearchMock(...args),
}));

import { CommandPalette } from "../CommandPalette.jsx";

function primeSearch(overrides = {}) {
  usePaletteSearchMock.mockReturnValue({
    assets: [],
    glossaryTerms: [],
    searching: false,
    searchError: "",
    resolvedQuery: "",
    ...overrides,
  });
}

function renderPalette(props = {}) {
  return render(
    <CommandPalette
      onClose={vi.fn()}
      onNavigateRef={vi.fn()}
      onSearchDiscovery={vi.fn()}
      seedAssets={[]}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  primeSearch();
});

describe("CommandPalette", () => {
  it("lists jump-to rows generated from the route table", () => {
    renderPalette();
    for (const label of [
      "Command Center",
      "Discover",
      "Stewardship",
      "Glossary & CDEs",
      "Lineage Atlas",
      "Evidence",
      "Control Center",
      "Help",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("renders results as real anchors with canonical hrefs", () => {
    primeSearch({
      assets: [{ fqn: "main.core.orders", name: "orders" }],
      glossaryTerms: [{ termId: "t-1", term: "Orders", definition: "Order fact" }],
    });
    renderPalette();
    fireEvent.change(screen.getByLabelText("Search assets, glossary terms, and owners"), {
      target: { value: "orders" },
    });
    const assetRow = screen.getByText("main.core.orders").closest("a");
    expect(assetRow.getAttribute("href")).toBe("/assets/main.core.orders");
    const termRow = screen.getByText("Orders").closest("a");
    expect(termRow.getAttribute("href")).toBe("/glossary/t-1");
  });

  it("navigates via the ref callback on click", () => {
    const onNavigateRef = vi.fn();
    primeSearch({ assets: [{ fqn: "main.core.orders", name: "orders" }] });
    renderPalette({ onNavigateRef });
    fireEvent.change(screen.getByLabelText("Search assets, glossary terms, and owners"), {
      target: { value: "orders" },
    });
    fireEvent.click(screen.getByText("main.core.orders").closest("a"));
    expect(onNavigateRef).toHaveBeenCalledWith({ kind: "asset", fqn: "main.core.orders" });
  });

  it("offers the Search Discover escape hatch for free text", () => {
    const onSearchDiscovery = vi.fn();
    renderPalette({ onSearchDiscovery });
    fireEvent.change(screen.getByLabelText("Search assets, glossary terms, and owners"), {
      target: { value: "quarterly revenue" },
    });
    fireEvent.click(screen.getByText(/Search Discover for/).closest("a"));
    expect(onSearchDiscovery).toHaveBeenCalledWith("quarterly revenue");
  });

  it("shows the honest in-flight state instead of claiming no matches", () => {
    primeSearch({ searching: true });
    renderPalette();
    fireEvent.change(screen.getByLabelText("Search assets, glossary terms, and owners"), {
      target: { value: "zz-nothing-matches-zz" },
    });
    // The free-text escape row always exists, so the live-status line renders.
    expect(screen.getByText("Searching the live catalog…")).toBeTruthy();
  });

  it("surfaces owners as discovery owner-search links", () => {
    primeSearch({
      assets: [{ fqn: "main.core.orders", name: "orders", owners: [{ name: "Dana Scully" }] }],
    });
    renderPalette();
    fireEvent.change(screen.getByLabelText("Search assets, glossary terms, and owners"), {
      target: { value: "dana" },
    });
    const ownerRow = screen.getByText("Dana Scully").closest("a");
    // URLSearchParams encodes spaces as "+" — decode accordingly.
    const href = ownerRow.getAttribute("href");
    expect(href.startsWith("/discovery?q=")).toBe(true);
    expect(new URLSearchParams(href.split("?")[1]).get("q")).toBe('owner:"Dana Scully"');
  });
});
