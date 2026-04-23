import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "govhub.theme";
const MODES = ["system", "light", "dark"];
const DEFAULT_MODE = "system";

function safeLocalStorageGet() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function safeLocalStorageSet(value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // private-browsing or quota — not fatal, state stays in-memory
  }
}

function matchesPrefersDark() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function normalizeMode(mode) {
  return MODES.includes(mode) ? mode : DEFAULT_MODE;
}

function resolveAppliedTheme(mode, prefersDark) {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return prefersDark ? "dark" : "light";
}

function applyThemeAttribute(applied) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", applied);
}

/**
 * Three-state theme toggle. Cycle order: system → light → dark → system.
 * Persists to localStorage and keeps `data-theme` on <html> in sync so
 * the `:root[data-theme="dark"]` overrides in colors.css apply without
 * a repaint.
 *
 * Previously the AppFrame pinned `data-theme="light"` unconditionally
 * (operator 2026-04-19 round 3 removed dark mode). Using this hook
 * replaces that pin and re-enables dark mode as an opt-in with a
 * system-preference default.
 */
export function useTheme() {
  const [mode, setModeState] = useState(() => normalizeMode(safeLocalStorageGet() || DEFAULT_MODE));
  const [prefersDark, setPrefersDark] = useState(matchesPrefersDark);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event) => setPrefersDark(event.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }
    // Safari < 14 fallback
    media.addListener(handler);
    return () => media.removeListener(handler);
  }, []);

  const appliedTheme = useMemo(() => resolveAppliedTheme(mode, prefersDark), [mode, prefersDark]);

  useEffect(() => {
    applyThemeAttribute(appliedTheme);
  }, [appliedTheme]);

  const setMode = useCallback((next) => {
    const normalized = normalizeMode(next);
    setModeState(normalized);
    safeLocalStorageSet(normalized);
  }, []);

  const cycleMode = useCallback(() => {
    setModeState((current) => {
      const index = MODES.indexOf(current);
      const nextIndex = (index + 1) % MODES.length;
      const next = MODES[nextIndex];
      safeLocalStorageSet(next);
      return next;
    });
  }, []);

  return {
    mode,
    appliedTheme,
    prefersDark,
    setMode,
    cycleMode,
  };
}

export const THEME_MODES = MODES;
export const THEME_STORAGE_KEY = STORAGE_KEY;
