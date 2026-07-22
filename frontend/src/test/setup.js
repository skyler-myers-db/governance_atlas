import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
}

afterEach(() => {
  cleanup();
});

// Node 22+ ships an experimental global localStorage that (without
// --localstorage-file) shadows jsdom's implementation and leaves
// window.localStorage/sessionStorage undefined in the test DOM. Install a
// plain in-memory Storage so tests that clear or read storage are
// environment-independent.
function memoryStorage() {
  let store = new Map();
  return {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => { store = new Map(); },
  };
}
for (const key of ["localStorage", "sessionStorage"]) {
  if (typeof window !== "undefined" && !window[key]) {
    Object.defineProperty(window, key, { value: memoryStorage(), configurable: true });
  }
}
