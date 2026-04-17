import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Breadcrumbs } from "../Breadcrumbs.jsx";

describe("Breadcrumbs", () => {
  it("renders nothing when no items are provided", () => {
    const { container } = render(<Breadcrumbs items={[]} />);
    expect(container.querySelector("nav")).toBeNull();
  });

  it("marks the final crumb as aria-current='page'", () => {
    render(
      <Breadcrumbs
        items={[
          { label: "Workspace" },
          { label: "Discovery" },
          { label: "orders" },
        ]}
      />,
    );
    const current = screen.getByText("orders").closest("li");
    expect(current?.getAttribute("aria-current")).toBe("page");
  });

  it("invokes per-item onClick when a non-final crumb is activated", () => {
    const handler = vi.fn();
    render(
      <Breadcrumbs
        items={[
          { label: "Workspace", onClick: handler },
          { label: "orders" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("falls back to onNavigate when a crumb has no onClick of its own", () => {
    const navigate = vi.fn();
    render(
      <Breadcrumbs
        items={[{ label: "Workspace", key: "ws" }, { label: "orders" }]}
        onNavigate={navigate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ key: "ws", label: "Workspace" }),
    );
  });
});
