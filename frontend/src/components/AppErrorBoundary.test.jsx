import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppErrorBoundary from "./AppErrorBoundary";

function ThrowOnRender() {
  throw new Error("Render exploded");
}

describe("AppErrorBoundary", () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders the shared fallback when a child throws during render", () => {
    render(
      <AppErrorBoundary>
        <ThrowOnRender />
      </AppErrorBoundary>,
    );

    expect(screen.getByText("Frontend Error")).not.toBeNull();
    expect(screen.getByText("The workspace hit an unexpected rendering failure.")).not.toBeNull();
    expect(screen.getByText("Render exploded")).not.toBeNull();
  });

  it("captures window error events without treating normal unavailable content as a crash", async () => {
    render(
      <AppErrorBoundary>
        <section>
          <h2>Workspace Unavailable</h2>
        </section>
      </AppErrorBoundary>,
    );

    expect(screen.getByText("Workspace Unavailable")).not.toBeNull();
    expect(screen.queryByText("Frontend Error")).toBeNull();

    const event = new Event("error");
    Object.defineProperty(event, "error", {
      value: new Error("Window failure"),
    });
    Object.defineProperty(event, "message", {
      value: "Window failure",
    });

    window.dispatchEvent(event);

    await waitFor(() => {
      expect(screen.getByText("Frontend Error")).not.toBeNull();
      expect(screen.getByText("Window failure")).not.toBeNull();
    });
  });

  it("captures unhandled promise rejections", async () => {
    render(
      <AppErrorBoundary>
        <div>Healthy child</div>
      </AppErrorBoundary>,
    );

    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", {
      value: "Async failure",
    });

    window.dispatchEvent(event);

    await waitFor(() => {
      expect(screen.getByText("Frontend Error")).not.toBeNull();
      expect(screen.getByText("Async failure")).not.toBeNull();
    });
  });
});
