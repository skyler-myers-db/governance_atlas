import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { TabStrip } from "../TabStrip";

const tabs = [
  { key: "overview", label: "Overview" },
  { key: "columns", label: "Columns", badge: 12 },
  { key: "quality", label: "Quality", disabled: true, disabledReason: "Quality service unavailable" },
  { key: "activity", label: "Activity" },
];

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.search}</div>;
}

function selectedTab() {
  return screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true");
}

describe("TabStrip", () => {
  it("renders a labelled tablist with tabs, selection state, and roving tabindex", () => {
    render(<TabStrip tabs={tabs} ariaLabel="Asset tabs" />);
    expect(screen.getByRole("tablist", { name: "Asset tabs" })).not.toBeNull();
    const rendered = screen.getAllByRole("tab");
    expect(rendered.length).toBe(4);
    expect(selectedTab().textContent).toContain("Overview");
    expect(selectedTab().getAttribute("tabindex")).toBe("0");
    expect(rendered[3].getAttribute("tabindex")).toBe("-1");
  });

  it("uncontrolled: clicking a tab moves selection", () => {
    render(<TabStrip tabs={tabs} defaultValue="overview" />);
    fireEvent.click(screen.getByRole("tab", { name: /Columns/ }));
    expect(selectedTab().textContent).toContain("Columns");
  });

  it("controlled: onChange fires but selection follows the value prop", () => {
    const onChange = vi.fn();
    render(<TabStrip tabs={tabs} value="overview" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /Activity/ }));
    expect(onChange).toHaveBeenCalledWith("activity");
    expect(selectedTab().textContent).toContain("Overview");
  });

  it("disabled tabs are unclickable and expose their reason", () => {
    const onChange = vi.fn();
    render(<TabStrip tabs={tabs} onChange={onChange} />);
    const disabled = screen.getByRole("tab", { name: /Quality/ });
    expect(disabled.disabled).toBe(true);
    expect(disabled.getAttribute("title")).toBe("Quality service unavailable");
    fireEvent.click(disabled);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders badges", () => {
    render(<TabStrip tabs={tabs} />);
    expect(screen.getByRole("tab", { name: /Columns/ }).textContent).toContain("12");
  });

  it("arrow keys move selection and skip disabled tabs", () => {
    render(<TabStrip tabs={tabs} defaultValue="columns" />);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    // quality is disabled → lands on activity
    expect(selectedTab().textContent).toContain("Activity");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "Home" });
    expect(selectedTab().textContent).toContain("Overview");
  });

  it("param string binds the strip to the URL search param (initial value from URL)", () => {
    render(
      <MemoryRouter initialEntries={["/assets/a.b.c?tab=columns"]}>
        <TabStrip tabs={tabs} param="tab" />
        <LocationProbe />
      </MemoryRouter>,
    );
    expect(selectedTab().textContent).toContain("Columns");
  });

  it("param string writes selection into the URL (replace) and keeps other params", () => {
    render(
      <MemoryRouter initialEntries={["/assets/a.b.c?tab=overview&col=x"]}>
        <TabStrip tabs={tabs} param="tab" />
        <LocationProbe />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Activity/ }));
    const search = new URLSearchParams(screen.getByTestId("loc").textContent);
    expect(search.get("tab")).toBe("activity");
    expect(search.get("col")).toBe("x");
    expect(selectedTab().textContent).toContain("Activity");
  });

  it("param adapter object ({value, set}) drives selection without a router", () => {
    const set = vi.fn();
    render(<TabStrip tabs={tabs} param={{ value: "columns", set }} />);
    expect(selectedTab().textContent).toContain("Columns");
    fireEvent.click(screen.getByRole("tab", { name: /Activity/ }));
    expect(set).toHaveBeenCalledWith("activity");
  });

  it("unknown URL param value falls back to the first enabled tab", () => {
    render(
      <MemoryRouter initialEntries={["/x?tab=nonsense"]}>
        <TabStrip tabs={tabs} param="tab" />
      </MemoryRouter>,
    );
    expect(selectedTab().textContent).toContain("Overview");
  });
});
