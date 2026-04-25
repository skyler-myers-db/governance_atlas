import { useEffect, useMemo, useRef, useState } from "react";
import { AssetTypeIcon } from "./AssetTypeIcon";

/**
 * CommandPalette — ⌘K/Ctrl+K overlay modal for jumping anywhere
 * in the app. Matches Linear / Raycast / GitHub's palette pattern.
 *
 * Ships with three command sources:
 *  - Navigation (Discovery / Lineage / Governance / Insights / Taxonomy / CDEs / Audit / Admin)
 *  - Recent assets (localStorage "gh-recent-assets")
 *  - Favorites (localStorage "gh-favorite-assets")
 *  - Fuzzy search on the current asset inventory
 *
 * Keyboard:
 *  - ⌘K / Ctrl+K — open
 *  - Esc — close
 *  - ↑ ↓ — navigate
 *  - Enter — run the highlighted item
 */

function readLocalJson(key, fallback = []) {
  if (typeof window === "undefined") return fallback;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "null");
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function matches(query, target) {
  const q = query.toLowerCase();
  const t = String(target || "").toLowerCase();
  if (!q) return true;
  // contiguous substring OR fuzzy (chars in order)
  if (t.includes(q)) return true;
  let j = 0;
  for (const ch of t) {
    if (ch === q[j]) j += 1;
    if (j >= q.length) return true;
  }
  return false;
}

export function CommandPalette({ assets = [], navigate, onClose }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  const recents = useMemo(() => readLocalJson("gh-recent-assets").slice(0, 5), []);
  const favorites = useMemo(() => readLocalJson("gh-favorite-assets").slice(0, 5), []);

  const items = useMemo(() => {
    const byFqn = new Map();
    for (const a of assets || []) {
      if (a?.fqn) byFqn.set(a.fqn, a);
    }
    const asAssetAction = (fqn, group) => {
      const asset = byFqn.get(fqn);
      if (!asset) return null;
      return {
        id: `${group}-${fqn}`,
        group,
        title: asset.name || fqn,
        subtitle: asset.fqn,
        asset,
        run: () => navigate?.({ surface: "entity", fqn }),
      };
    };
    const rows = [];
    rows.push(
      { id: "nav-home", group: "Jump to", title: "Home", subtitle: "Enterprise governance command center", run: () => navigate?.({ surface: "home" }) },
      { id: "nav-discovery", group: "Jump to", title: "Discovery", subtitle: "Browse the metadata catalog", run: () => navigate?.({ surface: "discovery" }) },
      { id: "nav-lineage", group: "Jump to", title: "Lineage", subtitle: "Connected asset graph", run: () => navigate?.({ surface: "lineage" }) },
      { id: "nav-governance", group: "Jump to", title: "Governance", subtitle: "Stewardship workbench", run: () => navigate?.({ surface: "governance" }) },
      { id: "nav-insights", group: "Jump to", title: "Insights", subtitle: "Governance signals and trends", run: () => navigate?.({ surface: "insights" }) },
      { id: "nav-taxonomy", group: "Jump to", title: "Taxonomy", subtitle: "Classifications, domains, data products", run: () => navigate?.({ surface: "taxonomy" }) },
      { id: "nav-cde", group: "Jump to", title: "CDEs", subtitle: "Critical data elements registry", run: () => navigate?.({ surface: "cde" }) },
      { id: "nav-audit", group: "Jump to", title: "Audit", subtitle: "Cross-entity audit events", run: () => navigate?.({ surface: "audit" }) },
      { id: "nav-admin", group: "Jump to", title: "Admin", subtitle: "Administration and control center", run: () => navigate?.({ surface: "admin" }) },
    );
    for (const fqn of favorites) {
      const item = asAssetAction(fqn, "Favorites");
      if (item) rows.push(item);
    }
    for (const fqn of recents) {
      const item = asAssetAction(fqn, "Recent");
      if (item && !rows.find((r) => r.id === item.id)) rows.push(item);
    }
    // Fuzzy-matched assets from inventory
    if (query) {
      const seen = new Set(rows.map((r) => r.id));
      for (const a of assets) {
        if (!a?.fqn) continue;
        if (matches(query, a.name) || matches(query, a.fqn) || matches(query, a.catalog) || matches(query, a.schema)) {
          const id = `asset-${a.fqn}`;
          if (seen.has(id)) continue;
          rows.push({
            id,
            group: "Assets",
            title: a.name || a.fqn,
            subtitle: a.fqn,
            asset: a,
            run: () => navigate?.({ surface: "entity", fqn: a.fqn }),
          });
          seen.add(id);
          if (rows.length >= 80) break;
        }
      }
    }
    // Filter entire list by query (lightweight)
    if (!query) return rows;
    return rows.filter(
      (row) => matches(query, row.title) || matches(query, row.subtitle) || matches(query, row.group),
    );
  }, [assets, query, navigate, recents, favorites]);

  const handleKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(items.length - 1, c + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = items[cursor];
      if (target) {
        target.run();
        onClose?.();
      }
    }
  };

  // Group items for section headers
  const grouped = useMemo(() => {
    const map = new Map();
    items.forEach((item, index) => {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group).push({ ...item, _idx: index });
    });
    return [...map.entries()];
  }, [items]);

  return (
    <div className="gh-cmdk-backdrop" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="gh-cmdk" onMouseDown={(e) => e.stopPropagation()}>
        <div className="gh-cmdk-input-row">
          <span className="gh-cmdk-prefix" aria-hidden="true">⌘</span>
          <input
            aria-label="Command palette search"
            className="gh-cmdk-input"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Jump to… (asset, page, or command)"
            ref={inputRef}
            type="search"
            value={query}
          />
          <span className="gh-cmdk-hint" aria-hidden="true">Esc to close</span>
        </div>
        <div className="gh-cmdk-list" role="listbox">
          {items.length === 0 ? (
            <div className="gh-cmdk-empty">No commands match "{query}"</div>
          ) : (
            grouped.map(([group, groupItems]) => (
              <div key={group}>
                <div className="gh-cmdk-group">{group}</div>
                {groupItems.map((item) => (
                  <button
                    aria-selected={cursor === item._idx}
                    className={`gh-cmdk-item ${cursor === item._idx ? "is-active" : ""}`}
                    key={item.id}
                    onClick={() => {
                      item.run();
                      onClose?.();
                    }}
                    onMouseEnter={() => setCursor(item._idx)}
                    role="option"
                    type="button"
                  >
                    <span className="gh-cmdk-item-glyph" aria-hidden="true">
                      {item.asset ? <AssetTypeIcon asset={item.asset} size="sm" /> : <span className="gh-cmdk-generic-glyph">›</span>}
                    </span>
                    <span className="gh-cmdk-item-text">
                      <span className="gh-cmdk-item-title">{item.title}</span>
                      <span className="gh-cmdk-item-subtitle">{item.subtitle}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="gh-cmdk-footer">
          <span className="gh-cmdk-footer-hint"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span className="gh-cmdk-footer-hint"><kbd>↵</kbd> open</span>
          <span className="gh-cmdk-footer-hint"><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
