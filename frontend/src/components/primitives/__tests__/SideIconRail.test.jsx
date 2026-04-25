import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NAV_ITEMS, SideIconRail } from "../SideIconRail";

describe("SideIconRail", () => {
  it.each(NAV_ITEMS)("renders $label as a visible navigation item", (item) => {
    render(<SideIconRail activeModule="home" currentAssetFqn="main.sales.orders" onModuleChange={() => {}} />);
    expect(screen.getByRole("button", { name: item.label })).not.toBeNull();
  });

  it("marks the active module with aria-current", () => {
    render(<SideIconRail activeModule="lineage" currentAssetFqn="main.sales.orders" onModuleChange={() => {}} />);
    const lineage = screen.getByRole("button", { name: "Lineage" });
    expect(lineage.getAttribute("aria-current")).toBe("page");
    expect(lineage.classList.contains("is-active")).toBe(true);
  });

  it("routes standard nav items by module key", () => {
    const onModuleChange = vi.fn();
    render(<SideIconRail activeModule="home" currentAssetFqn="main.sales.orders" onModuleChange={onModuleChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Governance" }));
    fireEvent.click(screen.getByRole("button", { name: "Admin" }));
    expect(onModuleChange).toHaveBeenNthCalledWith(1, "governance");
    expect(onModuleChange).toHaveBeenNthCalledWith(2, "admin");
  });

  it("routes Asset 360 to Discovery until an asset is in context", () => {
    const onModuleChange = vi.fn();
    render(<SideIconRail activeModule="home" onModuleChange={onModuleChange} />);
    const asset360 = screen.getByRole("button", { name: "Asset 360" });
    expect(asset360.disabled).toBe(false);
    fireEvent.click(asset360);
    expect(onModuleChange).toHaveBeenCalledWith("discovery");
  });

  it("opens Asset 360 with the dedicated asset callback when an asset is in context", () => {
    const onOpenAsset360 = vi.fn();
    render(
      <SideIconRail
        activeModule="entity"
        currentAssetFqn="main.sales.orders"
        onModuleChange={() => {}}
        onOpenAsset360={onOpenAsset360}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Asset 360" }));
    expect(onOpenAsset360).toHaveBeenCalledTimes(1);
  });
});
