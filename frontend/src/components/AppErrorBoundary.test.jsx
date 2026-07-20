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

  it("does NOT tear down the app for a stray global window error", async () => {
    // A single async/global error (a cancelled fetch, a browser extension,
    // a background prefetch reject) must not replace the whole UI. The app
    // stayed reachable; only a real React render error should show the card.
    render(
      <AppErrorBoundary>
        <section>
          <h2>Workspace Unavailable</h2>
        </section>
      </AppErrorBoundary>,
    );

    const event = new Event("error");
    Object.defineProperty(event, "error", { value: new Error("Window failure") });
    Object.defineProperty(event, "message", { value: "Window failure" });
    window.dispatchEvent(event);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("Workspace Unavailable")).not.toBeNull();
    expect(screen.queryByText("Frontend Error")).toBeNull();
  });

  it("does not convert ResizeObserver loop notifications into workspace crashes", async () => {
    render(
      <AppErrorBoundary>
        <section>
          <h2>Healthy workspace</h2>
        </section>
      </AppErrorBoundary>,
    );

    const event = new Event("error", { cancelable: true });
    Object.defineProperty(event, "error", {
      value: new Error("ResizeObserver loop completed with undelivered notifications."),
    });
    Object.defineProperty(event, "message", {
      value: "ResizeObserver loop completed with undelivered notifications.",
    });

    window.dispatchEvent(event);

    await waitFor(() => {
      expect(screen.getByText("Healthy workspace")).not.toBeNull();
      expect(screen.queryByText("Frontend Error")).toBeNull();
    });
  });

  it("does NOT tear down the app for a stray unhandled promise rejection", async () => {
    render(
      <AppErrorBoundary>
        <div>Healthy child</div>
      </AppErrorBoundary>,
    );

    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", { value: "Async failure" });
    window.dispatchEvent(event);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("Healthy child")).not.toBeNull();
    expect(screen.queryByText("Frontend Error")).toBeNull();
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
        "Failed to fetch dynamically imported module: https://atlas-2543889327043640.aws.databricksapps.com/assets/LineageWorkspace-C1U3X0Wm.js",
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
