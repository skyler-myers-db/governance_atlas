import { useEffect, useMemo } from "react";

const CSS_VAR_MAP = {
  primaryColor: "--gh-accent",
  accentColor: "--gh-accent-2",
};

function hexToRgba(hex, alpha) {
  if (typeof hex !== "string") return "";
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length !== 6) return "";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) return "";
  const a = Math.max(0, Math.min(1, Number(alpha || 1)));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function applyBranding(branding) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!branding || typeof branding !== "object") {
    Object.values(CSS_VAR_MAP).forEach((prop) => root.style.removeProperty(prop));
    root.style.removeProperty("--gh-accent-soft");
    return;
  }
  Object.entries(CSS_VAR_MAP).forEach(([key, cssVar]) => {
    const value = typeof branding[key] === "string" ? branding[key].trim() : "";
    if (value) {
      root.style.setProperty(cssVar, value);
    } else {
      root.style.removeProperty(cssVar);
    }
  });
  // Derive a soft accent (~8% alpha of primary) so hover/selection
  // surfaces keep their brand tint after a custom primary lands.
  const soft = hexToRgba(branding.primaryColor, 0.08);
  if (soft) {
    root.style.setProperty("--gh-accent-soft", soft);
  } else {
    root.style.removeProperty("--gh-accent-soft");
  }
}

/**
 * Read `shell.branding` from the bootstrap payload and apply it as
 * CSS custom properties on the root element. Returns the normalized
 * branding dict for components that need the logo URL or org name
 * (e.g. the shell brand glyph).
 */
export function useTenantBranding(bootstrap) {
  const branding = useMemo(() => {
    const raw = bootstrap?.shell?.branding || {};
    return {
      primaryColor: String(raw.primaryColor || "").trim(),
      accentColor: String(raw.accentColor || "").trim(),
      logoUrl: String(raw.logoUrl || "").trim(),
      orgDisplayName: String(raw.orgDisplayName || "").trim(),
    };
  }, [bootstrap?.shell?.branding]);

  useEffect(() => {
    applyBranding(branding);
  }, [branding]);

  return branding;
}
