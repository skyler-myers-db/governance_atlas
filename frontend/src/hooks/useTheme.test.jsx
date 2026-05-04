// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { THEME_MODES, THEME_STORAGE_KEY, useTheme } from "./useTheme";

// jsdom in this project ships without a working Storage implementation
// (localStorage.clear / removeItem are undefined on this version). Swap
// in a minimal in-memory polyfill so the hook's storage branches exercise.
function installLocalStoragePolyfill() {
  const store = new Map();
  const polyfill = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(String(key), String(value));
    },
    removeItem: (key) => {
      store.delete(String(key));
    },
    clear: () => {
      store.clear();
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: polyfill,
  });
  return polyfill;
}

function mockMatchMedia(matches) {
  const listeners = new Set();
  const control = {
    matches,
    dispatchChange: (next) => {
      control.matches = next;
      listeners.forEach((handler) => handler({ matches: next }));
    },
  };
  const mq = {
    get matches() {
      return control.matches;
    },
    addEventListener: (event, handler) => {
      if (event === "change") listeners.add(handler);
    },
    removeEventListener: (event, handler) => {
      if (event === "change") listeners.delete(handler);
    },
  };
  window.matchMedia = vi.fn().mockReturnValue(mq);
  return control;
}

describe("useTheme", () => {
  beforeEach(() => {
    installLocalStoragePolyfill();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to system mode and applies the prefers-color-scheme result", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("system");
    expect(result.current.appliedTheme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("falls back to light when prefers-color-scheme is false", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.appliedTheme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("restores mode from localStorage", () => {
    mockMatchMedia(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("dark");
    expect(result.current.appliedTheme).toBe("dark");
  });

  it("ignores bogus localStorage values", () => {
    mockMatchMedia(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "ultraviolet");
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("system");
  });

  it("cycleMode rotates through system → light → dark → system", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("system");
    act(() => result.current.cycleMode());
    expect(result.current.mode).toBe("light");
    act(() => result.current.cycleMode());
    expect(result.current.mode).toBe("dark");
    act(() => result.current.cycleMode());
    expect(result.current.mode).toBe("system");
  });

  it("persists cycleMode result to localStorage", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.cycleMode());
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("setMode accepts a specific mode and applies it", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode("dark"));
    expect(result.current.appliedTheme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("responds to prefers-color-scheme change when mode is system", () => {
    const store = mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.appliedTheme).toBe("light");
    act(() => store.dispatchChange(true));
    expect(result.current.appliedTheme).toBe("dark");
  });

  it("ignores prefers-color-scheme change when an explicit mode is set", () => {
    const store = mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode("light"));
    act(() => store.dispatchChange(true));
    expect(result.current.appliedTheme).toBe("light");
  });

  it("exposes THEME_MODES constant covering exactly the three supported modes", () => {
    expect(THEME_MODES).toEqual(["system", "light", "dark"]);
  });
});
