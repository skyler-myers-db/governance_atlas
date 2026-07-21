import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterBar } from "../FilterBar";

const facets = [
  { key: "q", label: "Search assets", type: "search" },
  {
    key: "tier",
    label: "Tier",
    type: "select",
    options: [
      { value: "gold", label: "Gold" },
      { value: "silver", label: "Silver" },
    ],
  },
  {
    key: "domains",
    label: "Domain",
    type: "multi",
    options: [
      { value: "finance", label: "Finance", count: 12 },
      { value: "sales", label: "Sales", count: 30 },
    ],
  },
];

describe("FilterBar", () => {
  it("renders a labelled group with one control per facet", () => {
    render(<FilterBar facets={facets} value={{}} onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Filters" })).not.toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search assets" })).not.toBeNull();
    expect(screen.getByRole("combobox")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Domain/ })).not.toBeNull();
  });

  it("search facet emits the full next value map", () => {
    const onChange = vi.fn();
    render(<FilterBar facets={facets} value={{ tier: "gold" }} onChange={onChange} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "pii" } });
    expect(onChange).toHaveBeenCalledWith({ tier: "gold", q: "pii" });
  });

  it("select facet sets and clears its key (empty selection removes the key)", () => {
    const onChange = vi.fn();
    const { rerender } = render(<FilterBar facets={facets} value={{}} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "silver" } });
    expect(onChange).toHaveBeenCalledWith({ tier: "silver" });
    rerender(<FilterBar facets={facets} value={{ tier: "silver" }} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("multi facet opens a popover of checkboxes and toggles values", () => {
    const onChange = vi.fn();
    render(<FilterBar facets={facets} value={{ domains: ["finance"] }} onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: /Domain/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(2);
    expect(checkboxes[0].checked).toBe(true);
    fireEvent.click(checkboxes[1]);
    expect(onChange).toHaveBeenCalledWith({ domains: ["finance", "sales"] });
    // unchecking the only selected value removes the key entirely
    fireEvent.click(checkboxes[0]);
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("multi facet shows a selected count and closes on Escape", () => {
    render(<FilterBar facets={facets} value={{ domains: ["finance", "sales"] }} onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: /Domain/ });
    expect(trigger.textContent).toContain("2");
    fireEvent.click(trigger);
    expect(screen.getAllByRole("checkbox").length).toBe(2);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryAllByRole("checkbox").length).toBe(0);
  });

  it("Clear filters appears only when a facet has a value, and resets the map", () => {
    const onChange = vi.fn();
    const { rerender } = render(<FilterBar facets={facets} value={{}} onChange={onChange} />);
    expect(screen.queryByText("Clear filters")).toBeNull();
    rerender(<FilterBar facets={facets} value={{ q: "pii" }} onChange={onChange} />);
    fireEvent.click(screen.getByText("Clear filters"));
    expect(onChange).toHaveBeenCalledWith({});
  });
});
