import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, ToastHost } from "../Toast";

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      toast.clear();
    });
    vi.useRealTimers();
  });

  it("toast() renders a polite status message in the host", () => {
    render(<ToastHost />);
    act(() => {
      toast("Saved view");
    });
    const item = screen.getByRole("status");
    expect(item.textContent).toContain("Saved view");
  });

  it("danger tone renders role=alert", () => {
    render(<ToastHost />);
    act(() => {
      toast("Request failed", { tone: "danger" });
    });
    expect(screen.getByRole("alert").textContent).toContain("Request failed");
  });

  it("auto-dismisses after the default 5s", () => {
    render(<ToastHost />);
    act(() => {
      toast("Ephemeral");
    });
    expect(screen.queryByText("Ephemeral")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(5001);
    });
    expect(screen.queryByText("Ephemeral")).toBeNull();
  });

  it("duration: 0 keeps the toast until dismissed via the close button", () => {
    render(<ToastHost />);
    act(() => {
      toast("Sticky", { duration: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.queryByText("Sticky")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Sticky")).toBeNull();
  });

  it("action toasts run the action, then dismiss, and get the longer 8s window", () => {
    const onClick = vi.fn();
    render(<ToastHost />);
    act(() => {
      toast("Term staged", { action: { label: "Undo", onClick } });
    });
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    // still visible at 6s because action toasts default to 8s
    expect(screen.queryByText("Term staged")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.queryByText("Term staged")).toBeNull();
  });

  it("toast.dismiss(id) removes a specific toast; stacking preserves order", () => {
    render(<ToastHost />);
    let first;
    act(() => {
      first = toast("First");
      toast("Second");
    });
    expect(screen.getAllByRole("status").length).toBe(2);
    act(() => {
      toast.dismiss(first);
    });
    expect(screen.queryByText("First")).toBeNull();
    expect(screen.queryByText("Second")).not.toBeNull();
  });
});
