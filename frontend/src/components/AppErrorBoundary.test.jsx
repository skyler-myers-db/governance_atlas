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

  it("shows a friendly reload-now card when a lazy chunk import fails after a redeploy", async () => {
    render(
      <AppErrorBoundary>
        <div>Healthy child</div>
      </AppErrorBoundary>,
    );

    // Classic Chromium/Safari stale-chunk message. This is what the user
    // was seeing on 2026-04-20 after a deploy: the open tab held a stale
    // index.js that referenced a LineageWorkspace-*.js hash that no
    // longer existed.
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", {
      value: new TypeError(
        "Failed to fetch dynamically imported module: https://governance-hub-7405619023278880.0.azure.databricksapps.com/assets/LineageWorkspace-C1U3X0Wm.js",
      ),
    });

    window.dispatchEvent(event);

    await waitFor(() => {
      // Stale-chunk path renders the "New version available" copy, not
      // the generic "Frontend Error" card.
      expect(screen.getByText("New version available")).not.toBeNull();
      expect(screen.getByText("Reload now")).not.toBeNull();
      expect(screen.queryByText("Frontend Error")).toBeNull();
    });
  });

  it("treats `ChunkLoadError` as a stale-bundle reload prompt too", async () => {
    render(
      <AppErrorBoundary>
        <div>Healthy child</div>
      </AppErrorBoundary>,
    );

    const chunkError = new Error("Loading chunk 42 failed.");
    chunkError.name = "ChunkLoadError";
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", { value: chunkError });

    window.dispatchEvent(event);

    await waitFor(() => {
      expect(screen.getByText("New version available")).not.toBeNull();
    });
  });
});
