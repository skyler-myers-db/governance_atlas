import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ASSET_360_NAV_ITEM, NAV_ITEMS, SideIconRail } from "../SideIconRail";

describe("SideIconRail", () => {
  it.each(NAV_ITEMS)("renders $label as a visible navigation item", (item) => {
    render(<SideIconRail activeModule="home" currentAssetFqn="main.sales.orders" onModuleChange={() => {}} />);
    expect(screen.getByRole("button", { name: item.label })).not.toBeNull();
  });

  it("marks the active module with aria-current", () => {
    render(<SideIconRail activeModule="lineage" currentAssetFqn="main.sales.orders" onModuleChange={() => {}} />);
    const lineage = screen.getByRole("button", { name: "Lineage Atlas" });
    expect(lineage.getAttribute("aria-current")).toBe("page");
    expect(lineage.classList.contains("is-active")).toBe(true);
  });

  it("routes standard nav items by module key", () => {
    const onModuleChange = vi.fn();
    render(<SideIconRail activeModule="home" currentAssetFqn="main.sales.orders" onModuleChange={onModuleChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Stewardship" }));
    fireEvent.click(screen.getByRole("button", { name: "Control Center" }));
    expect(onModuleChange).toHaveBeenNthCalledWith(1, "governance");
    expect(onModuleChange).toHaveBeenNthCalledWith(2, "admin");
  });

  it("keeps Asset 360 out of the primary prototype rail while preserving the route metadata", () => {
    render(<SideIconRail activeModule="home" onModuleChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Asset 360" })).toBeNull();
    expect(ASSET_360_NAV_ITEM.moduleKey).toBe("entity");
    expect(ASSET_360_NAV_ITEM.requiresAsset).toBe(true);
  });

  it("renders the stewardship badge only when a real count is supplied", () => {
    const { rerender } = render(
      <SideIconRail activeModule="home" onModuleChange={() => {}} stewardshipCount={0} />,
    );
    expect(screen.queryByText("0")).toBeNull();
    rerender(<SideIconRail activeModule="home" onModuleChange={() => {}} stewardshipCount={184} />);
    expect(screen.getByText("184")).not.toBeNull();
  });
});
