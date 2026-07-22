/**
 * nav/useSurfaceParams.js — typed, schema-driven URL param state (Wave A3).
 *
 * "The URL is the state": every piece of view state worth restoring lives in
 * surface-scoped search params, read/written through the surface's paramsSchema
 * (nav/routes.js). This replaces per-surface local state + sessionStorage
 * snapshots + raw history.replaceState bypasses (FRONTEND_BLUEPRINT §8).
 *
 * Usage:
 *   const [params, setParams] = useSurfaceParams(route.paramsSchema);
 *   params.q                       // typed: string | boolean | array | parsed JSON
 *   setParams({ q: "revenue" });               // default: replace (sub-state edit)
 *   setParams({ filters: next }, { push: true }); // push = new history entry
 *
 * Semantics:
 *   - Types: "string" | "array" (repeatable param) | "json" | "bool".
 *   - Values equal to their default (or empty) are removed from the URL.
 *   - Writes default to REPLACE — refining state in place shouldn't spam
 *     history; pass { push: true } for fresh openings (preserves the legacy
 *     push/replace discipline from useAppRouteState.js:427-449).
 *   - Params outside the schema (e.g. ?peek= managed by usePeek) are preserved
 *     untouched on every write.
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { normalizeSchema, parseSearch, writeParams } from "./routes.js";

export function useSurfaceParams(schema) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Schemas are module-level constants in routes.js, so identity is stable;
  // normalize once per schema object.
  const normalized = useMemo(() => normalizeSchema(schema), [schema]);

  const values = useMemo(
    () => parseSearch(normalized, searchParams),
    [normalized, searchParams],
  );

  const setParams = useCallback(
    (patch, { push = false } = {}) => {
      setSearchParams((prev) => writeParams(normalized, prev, patch), { replace: !push });
    },
    [normalized, setSearchParams],
  );

  return [values, setParams];
}
