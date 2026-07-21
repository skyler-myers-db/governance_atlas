import { useEffect, useMemo, useRef, useState } from "react";
import { fetchDiscoverySearch, fetchGovernanceGlossary } from "../../lib/api";
import { AssetTypeIcon } from "./AssetTypeIcon";

/**
 * CommandPalette — ⌘K/Ctrl+K overlay modal for jumping anywhere
 * in the app. Matches Linear / Raycast / GitHub's palette pattern.
 *
 * Command sources:
 *  - Navigation (Command Center / Discover / Stewardship / Glossary & CDEs / Lineage Atlas / Audit Evidence / Control Center)
 *  - Recent assets (localStorage "gh-recent-assets")
 *  - Favorites (localStorage "gh-favorite-assets")
 *  - LIVE discovery search (/discovery/search) — the shell only seeds a
 *    handful of assets, so a static in-memory match made real asset names
 *    return "no matches". Asset results now come from the same live search
 *    API Discover uses, debounced while typing.
 *  - Glossary terms (live /governance/glossary — the search promise
 *    "assets, glossary terms, owners" must actually be kept)
 *  - Owners (distinct owners across the seed inventory AND the live search
 *    payload, so people who only own non-seeded assets are findable)
 *
 * Keyboard:
 *  - ⌘K / Ctrl+K — open
 *  - Esc — close
 *  - ↑ ↓ — navigate
 *  - Enter — run the highlighted item
 */

// Debounce for the live discovery query — long enough to not spam the API on
// every keystroke, short enough to feel live.
const LIVE_SEARCH_DEBOUNCE_MS = 250;
const LIVE_SEARCH_MIN_CHARS = 2;
const LIVE_SEARCH_LIMIT = 8;

function readLocalJson(key, fallback = []) {
  if (typeof window === "undefined") return fallback;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "null");
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function ownerDisplayName(owner) {
  if (typeof owner === "string") return owner.trim();
  if (!owner || typeof owner !== "object") return "";
  return String(owner.name || owner.email || owner.ownerEmail || "").trim();
}

// Distinct owner names across the visible inventory — the palette's owner
// results navigate to Discover's structured owner search.
function distinctOwners(assets = []) {
  const names = new Set();
  for (const asset of Array.isArray(assets) ? assets : []) {
    const owners = Array.isArray(asset?.owners) ? asset.owners : [];
    for (const owner of owners) {
      const name = ownerDisplayName(owner);
      if (name) names.add(name);
    }
    const single = ownerDisplayName(asset?.owner);
    if (single) names.add(single);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
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
  // Glossary terms load once per palette open; a failed fetch simply omits
  // the terms group (assets/owners keep working) — no fabricated rows.
  const [glossaryTerms, setGlossaryTerms] = useState([]);
  // Live discovery results for the current query. state: idle | loading |
  // ready | error. A failed live search degrades to the seed inventory
  // (never a fabricated result, never a blocked palette).
  const [liveSearch, setLiveSearch] = useState({ state: "idle", assets: [], forQuery: "" });
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced live asset search. The palette used to match only the static
  // seed inventory, so real asset names ("customer_profile") and owners
  // returned "no matches" with zero network calls — the P1 the persona
  // audit proved. Every keystroke resets the timer; unmount/next-query
  // aborts the in-flight request.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < LIVE_SEARCH_MIN_CHARS) {
      setLiveSearch({ state: "idle", assets: [], forQuery: "" });
      return undefined;
    }
    setLiveSearch((current) => ({ ...current, state: "loading", forQuery: trimmed }));
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchDiscoverySearch(
        { query: trimmed, limit: LIVE_SEARCH_LIMIT },
        { signal: controller.signal },
      )
        .then((payload) => {
          const liveAssets = Array.isArray(payload?.assets) ? payload.assets : [];
          setLiveSearch({ state: "ready", assets: liveAssets, forQuery: trimmed });
        })
        .catch((error) => {
          if (error?.name === "AbortError") return;
          // Seed-inventory matching still works below; just stop "loading".
          setLiveSearch({ state: "error", assets: [], forQuery: trimmed });
        });
    }, LIVE_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    fetchGovernanceGlossary()
      .then((payload) => {
        if (cancelled) return;
        const terms = Array.isArray(payload?.glossary) ? payload.glossary : [];
        setGlossaryTerms(terms);
      })
      .catch(() => {
        /* Terms group stays absent; the palette must not block on it. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  const recents = useMemo(() => readLocalJson("gh-recent-assets").slice(0, 5), []);
  const favorites = useMemo(() => readLocalJson("gh-favorite-assets").slice(0, 5), []);
  // Owners come from the seed inventory PLUS the live search payload — the
  // seed rarely carries every owner in the estate.
  const owners = useMemo(
    () => distinctOwners([...(Array.isArray(assets) ? assets : []), ...liveSearch.assets]),
    [assets, liveSearch.assets],
  );

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
      { id: "nav-home", group: "Jump to", title: "Command Center", subtitle: "Executive governance posture", run: () => navigate?.({ surface: "home" }) },
      { id: "nav-discovery", group: "Jump to", title: "Discover", subtitle: "Find governed data and terms", run: () => navigate?.({ surface: "discovery" }) },
      { id: "nav-governance", group: "Jump to", title: "Stewardship", subtitle: "Open governance work queue", run: () => navigate?.({ surface: "governance" }) },
      { id: "nav-taxonomy", group: "Jump to", title: "Glossary & CDEs", subtitle: "Business terms and critical data elements", run: () => navigate?.({ surface: "taxonomy" }) },
      { id: "nav-lineage", group: "Jump to", title: "Lineage Atlas", subtitle: "Connected asset graph", run: () => navigate?.({ surface: "lineage" }) },
      { id: "nav-audit", group: "Jump to", title: "Audit Evidence", subtitle: "Immutable governance event log", run: () => navigate?.({ surface: "audit" }) },
      { id: "nav-admin", group: "Jump to", title: "Control Center", subtitle: "Runtime, integrations, and policy", run: () => navigate?.({ surface: "admin" }) },
    );
    for (const fqn of favorites) {
      const item = asAssetAction(fqn, "Favorites");
      if (item) rows.push(item);
    }
    for (const fqn of recents) {
      const item = asAssetAction(fqn, "Recent");
      if (item && !rows.find((r) => r.id === item.id)) rows.push(item);
    }
    // The static command/recent/favorite rows are filtered by the query;
    // query-derived rows (live assets, terms, owners) already matched —
    // re-filtering them here dropped server matches (e.g. description hits)
    // whose title didn't fuzzy-match client-side.
    const staticRows = query
      ? rows.filter(
          (row) => matches(query, row.title) || matches(query, row.subtitle) || matches(query, row.group),
        )
      : rows;
    const queryRows = [];
    if (query) {
      const seen = new Set(staticRows.map((r) => r.id));
      const pushAssetRow = (a) => {
        if (!a?.fqn) return;
        const id = `asset-${a.fqn}`;
        if (seen.has(id)) return;
        queryRows.push({
          id,
          group: "Assets",
          title: a.name || a.fqn,
          subtitle: a.fqn,
          badge: "Asset",
          asset: a,
          run: () => navigate?.({ surface: "entity", fqn: a.fqn }),
        });
        seen.add(id);
      };
      // Live discovery results lead (authoritative, server-ranked)…
      if (liveSearch.forQuery === query.trim()) {
        for (const a of liveSearch.assets) pushAssetRow(a);
      }
      // …then fuzzy matches from the local seed inventory fill in.
      let assetRows = queryRows.length;
      for (const a of assets) {
        if (assetRows >= 20) break;
        if (!a?.fqn) continue;
        if (matches(query, a.name) || matches(query, a.fqn) || matches(query, a.catalog) || matches(query, a.schema)) {
          pushAssetRow(a);
          assetRows = queryRows.length;
        }
      }
      // Glossary terms — the ⌘K placeholder promises them; deliver them.
      // A term result deep-links to /glossary?term=<id-or-name> via the
      // taxonomy surface's pending-term consumer.
      let termRows = 0;
      for (const term of glossaryTerms) {
        const name = String(term?.term || term?.name || "").trim();
        if (!name) continue;
        const definition = String(term?.definition || "").trim();
        if (!(matches(query, name) || matches(query, definition) || matches(query, term?.domain))) continue;
        const termId = String(term?.termId || "").trim();
        queryRows.push({
          id: `term-${termId || name}`,
          group: "Glossary terms",
          title: name,
          subtitle: definition || String(term?.domain || "").trim() || "Glossary term",
          badge: "Term",
          run: () => navigate?.({ surface: "taxonomy", term: termId || name }),
        });
        termRows += 1;
        if (termRows >= 8) break;
      }
      // Owners — distinct owners across seed + live inventory; an owner
      // result opens Discover's structured owner search (owner:"Name").
      let ownerRows = 0;
      for (const owner of owners) {
        if (!matches(query, owner)) continue;
        queryRows.push({
          id: `owner-${owner}`,
          group: "Owners",
          title: owner,
          subtitle: `Search Discover for assets owned by ${owner}`,
          badge: "Owner",
          run: () => navigate?.({ surface: "discovery", query: `owner:"${owner}"` }),
        });
        ownerRows += 1;
        if (ownerRows >= 6) break;
      }
    }
    return [...staticRows, ...queryRows];
  }, [assets, glossaryTerms, liveSearch, owners, query, navigate, recents, favorites]);

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

  const liveSearching =
    liveSearch.state === "loading" && query.trim().length >= LIVE_SEARCH_MIN_CHARS;

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
            placeholder="Search assets, glossary terms, owners…"
            ref={inputRef}
            type="search"
            value={query}
          />
          <span className="gh-cmdk-hint" aria-hidden="true">Esc to close</span>
        </div>
        <div className="gh-cmdk-list" role="listbox">
          {items.length === 0 ? (
            liveSearching ? (
              // Honest in-flight state: never claim "no matches" while the
              // live query is still out.
              <div aria-busy="true" className="gh-cmdk-empty is-loading" role="status">
                Searching assets, glossary terms, and owners…
              </div>
            ) : (
              // Plain-language empty copy — "No commands match" read as
              // command-palette jargon on what is presented as a search box.
              <div className="gh-cmdk-empty">
                {query.trim()
                  ? `No matches for "${query.trim()}"`
                  : "Type to search assets, glossary terms, and owners."}
              </div>
            )
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
                    {item.badge ? (
                      <span aria-hidden="true" className="gh-cmdk-item-badge">{item.badge}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))
          )}
          {items.length > 0 && liveSearching ? (
            // Results are visible from the seed inventory while the live
            // query is still in flight — say so instead of flickering.
            <div aria-busy="true" className="gh-cmdk-live-status" role="status">
              Searching the live catalog…
            </div>
          ) : null}
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
