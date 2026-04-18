import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SurfaceDrawer } from "./ShellLayoutPrimitives";

function DrawerHarness({ initiallyOpen = true }) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} data-testid="trigger">
        Open drawer
      </button>
      <button type="button" data-testid="outside-before">
        Outside before
      </button>
      <SurfaceDrawer
        title="Drawer title"
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        actions={
          <button type="button" data-testid="head-action">
            Close
          </button>
        }
      >
        <button type="button" data-testid="inner-a">
          Inner A
        </button>
        <button type="button" data-testid="inner-b">
          Inner B
        </button>
      </SurfaceDrawer>
      <button type="button" data-testid="outside-after">
        Outside after
      </button>
    </>
  );
}

describe("SurfaceDrawer accessibility", () => {
  it("gives the drawer a dialog role and aria-modal when open", () => {
    render(<DrawerHarness />);
    const drawer = screen.getByRole("dialog");
    expect(drawer.getAttribute("aria-modal")).toBe("true");
  });

  it("drops the dialog role when closed", () => {
    render(<DrawerHarness initiallyOpen={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape via onClose", () => {
    const onClose = vi.fn();
    render(
      <SurfaceDrawer isOpen title="Title" onClose={onClose}>
        <button type="button">Inside</button>
      </SurfaceDrawer>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not explode on Escape when onClose is not provided", () => {
    render(
      <SurfaceDrawer isOpen title="Title">
        <button type="button">Inside</button>
      </SurfaceDrawer>,
    );
    // Should not throw.
    fireEvent.keyDown(document, { key: "Escape" });
  });

  it("moves focus to the first focusable element inside the drawer on open", async () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    try {
      render(<DrawerHarness />);
      await waitFor(() => {
        expect(document.activeElement?.getAttribute("data-testid")).toBe("head-action");
      });
    } finally {
      rafSpy.mockRestore();
    }
  });

  it("traps Tab at the last focusable, wrapping back to the first", () => {
    render(
      <SurfaceDrawer isOpen title="Title" onClose={() => {}}>
        <button type="button" data-testid="only">
          Only
        </button>
      </SurfaceDrawer>,
    );
    const only = screen.getByTestId("only");
    only.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(only);
  });
});
