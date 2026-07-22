/*
 * Import guard: the kit ships unused in Wave A (consumers arrive in Waves
 * B/C), so nothing in the app bundle imports it yet. This test imports the
 * whole barrel so the kit is compiled by vitest/vite on every run — a
 * broken export or syntax error fails CI even with zero consumers, without
 * touching main.jsx.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as kit from "../index.js";
import { normalizeStatus, QUERY_STATUSES } from "../statusContract";

describe("system kit barrel", () => {
  it("exports every component and contract named in FRONTEND_BLUEPRINT §6", () => {
    const expected = [
      "PageShell",
      "SectionCard",
      "StatTile",
      "EntityChip",
      "DataTable",
      "StateViews",
      "LoadingState",
      "EmptyState",
      "UnavailableState",
      "StatusBanner",
      "ForQuery",
      "toast",
      "ToastHost",
      "Drawer",
      "TabStrip",
      "FilterBar",
      "Badge",
      "Button",
      "hrefForRef",
      "defaultRefLabel",
      "normalizeStatus",
      "statusShowsData",
      "QUERY_STATUSES",
    ];
    for (const name of expected) {
      expect(kit[name], `missing export: ${name}`).toBeDefined();
    }
  });

  it("composes end-to-end: a PageShell with kit children renders without a router", () => {
    render(
      <kit.PageShell title="Kit smoke" status="available">
        <kit.SectionCard title="Section">
          <kit.EntityChip entity={{ kind: "asset", fqn: "a.b.c" }} />
          <kit.Badge status="certified" />
          <kit.Button>Act</kit.Button>
        </kit.SectionCard>
      </kit.PageShell>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Kit smoke");
    expect(screen.getByRole("link").getAttribute("href")).toBe("/assets/a.b.c");
    expect(screen.getByText("certified")).not.toBeNull();
  });
});

describe("normalizeStatus (Wave-A2 contract shape)", () => {
  it("recognizes exactly the six contract statuses", () => {
    expect(QUERY_STATUSES).toEqual([
      "loading",
      "hydrating",
      "available",
      "degraded",
      "unavailable",
      "error",
    ]);
    for (const status of QUERY_STATUSES) {
      expect(normalizeStatus(status)?.status).toBe(status);
      expect(normalizeStatus({ status })?.status).toBe(status);
    }
  });

  it("returns null for unknown or missing statuses (components render nothing, never guess)", () => {
    expect(normalizeStatus(null)).toBeNull();
    expect(normalizeStatus("banana")).toBeNull();
    expect(normalizeStatus({ status: "ok" })).toBeNull();
  });

  it("extracts warnings, reason (explicit > meta > first warning), and refresh", () => {
    const refresh = () => {};
    const norm = normalizeStatus({
      status: "degraded",
      warnings: ["W1", null, "W2"],
      refresh,
    });
    expect(norm.warnings).toEqual(["W1", "W2"]);
    expect(norm.reason).toBe("W1");
    expect(norm.refresh).toBe(refresh);
    expect(
      normalizeStatus({ status: "unavailable", meta: { emptyReason: "no-lineage-rows" } }).reason,
    ).toBe("no-lineage-rows");
    expect(normalizeStatus({ status: "unavailable", reason: "explicit" }).reason).toBe("explicit");
  });
});
