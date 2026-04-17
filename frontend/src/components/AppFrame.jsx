import { useEffect, useRef, useState } from "react";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { assetPathLabel, displayObjectType } from "../lib/assetPresentation";
import { openAssetRecordSafely } from "../lib/assetRecordNavigation";
import { workspaceAccessBanner } from "../lib/capabilities";
import { InlineStatusBanner } from "./ShellStatePrimitives";

function statusTone(bootState) {
  if (bootState === "unavailable" || bootState === "error") return "bad";
  return "neutral";
}

function statusLabel(bootState) {
  if (bootState === "unavailable" || bootState === "error") return "Unavailable";
  return "Live";
}

function humanizeStatusLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "Unknown";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function setupStatusTone(state) {
  const normalized = String(state || "").trim().toLowerCase();
  if (normalized === "blocked" || normalized === "unavailable") return "bad";
  if (normalized === "attention_required" || normalized === "unknown") return "warn";
  if (normalized === "ready") return "good";
  return "neutral";
}

function setupStatusLabel(state) {
  const normalized = String(state || "").trim().toLowerCase();
  if (normalized === "blocked") return "Setup blocked";
  if (normalized === "attention_required") return "Setup attention";
  if (normalized === "unavailable") return "Setup unavailable";
  if (normalized === "unknown") return "Setup unknown";
  if (normalized === "ready") return "Setup ready";
  return "Workspace setup";
}

function inboxStatusTone(state) {
  const normalized = String(state || "").trim().toLowerCase();
  if (normalized === "unavailable") return "bad";
  if (normalized === "degraded" || normalized === "attention_required") return "warn";
  if (normalized === "ready" || normalized === "available") return "good";
  return "neutral";
}

function inboxStatusLabel(state) {
  const normalized = String(state || "").trim().toLowerCase();
  if (normalized === "ready" || normalized === "available") return "Inbox ready";
  if (normalized === "degraded") return "Inbox degraded";
  if (normalized === "unavailable") return "Inbox unavailable";
  if (normalized === "attention_required") return "Inbox attention";
  return "Inbox";
}

const MODULES = [
  {
    key: "discovery",
    label: "Discovery",
  },
  {
    key: "lineage",
    label: "Lineage",
  },
  {
    key: "governance",
    label: "Governance",
  },
];

function SearchDropdown({
  assets,
  error,
  loading,
  scopeLabel = "visible assets",
  notice,
  onBrowseCatalog,
  onSelectAsset,
  query,
  topDirectResult,
}) {
  const trimmedQuery = query.trim();
  const searchStatus = loading
    ? `Searching ${scopeLabel}...`
    : trimmedQuery
      ? `Direct matches across ${scopeLabel}`
      : `Start typing to search ${scopeLabel}`;
  const searchCount = loading
    ? ""
    : assets.length
      ? `${assets.length} matches`
      : trimmedQuery
        ? "No direct matches"
        : "Type to search";

  return (
    <div className="gh-search-dropdown">
      <div className="gh-search-dropdown-head">
        <div>
          <div className="gh-eyebrow">Search results</div>
          <div className="gh-search-dropdown-status">{searchStatus}</div>
        </div>
        {searchCount ? <div className="gh-search-dropdown-status">{searchCount}</div> : null}
      </div>

      {error ? <div className="gh-search-empty">{error}</div> : null}
      {!error && notice ? <div className="gh-search-empty">{notice}</div> : null}

      {!error && assets.length ? (
        <div className="gh-search-results">
          {assets.map((asset) => (
            <button
              className="gh-search-result-row"
              key={asset.fqn}
              onClick={() => onSelectAsset(asset.fqn)}
              type="button"
            >
              <span className="gh-search-result-main">
                <span className="gh-search-result-title">{asset.name}</span>
                <span className="gh-search-result-subtitle">{assetPathLabel(asset)}</span>
              </span>
              <span className="gh-search-result-meta">
                {displayObjectType(asset) ? (
                  <span className="gh-chip gh-chip-soft">{displayObjectType(asset)}</span>
                ) : null}
                {asset.domain && asset.domain !== "Unassigned" ? (
                  <span className="gh-chip gh-chip-soft">{asset.domain}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {!error && !loading && trimmedQuery && !assets.length ? (
        <div className="gh-search-empty">
          No direct asset matches yet. Press Enter to open the full discovery workspace.
        </div>
      ) : null}

      <div className="gh-search-dropdown-foot">
        {topDirectResult ? (
          <button
            className="gh-tertiary-button gh-inline-link-button"
            onClick={() => onSelectAsset(topDirectResult.fqn)}
            type="button"
          >
            Open top result
          </button>
        ) : null}
        <button className="gh-tertiary-button gh-inline-link-button" onClick={onBrowseCatalog} type="button">
          Browse full results
        </button>
      </div>
    </div>
  );
}

export default function AppFrame({
  shell,
  searchSeedAssets = [],
  visibleAssetSet = new Set(),
  workspaceAccess = null,
  activeModule,
  diagnosticsAvailable = false,
  diagnosticsStatus = null,
  diagnosticsOpen = false,
  governanceInbox = null,
  inboxOpen = false,
  onModuleChange,
  onToggleDiagnostics,
  onToggleInbox,
  onInboxItemAction,
  bootState,
  bootMessage,
  liveCatalogVisibleCount = null,
  navigationState,
  onBrowseCatalog,
  onNavigationStateChange,
  onSearchResultSelect,
  children,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchNotice, setSearchNotice] = useState("");
  const [shellHeaderHeight, setShellHeaderHeight] = useState(0);
  const shellHeaderRef = useRef(null);
  const searchRootRef = useRef(null);
  const hasRenderableLiveCatalog =
    (typeof liveCatalogVisibleCount === "number" && liveCatalogVisibleCount > 0) ||
    visibleAssetSet?.size > 0;
  const visibleCatalogCount =
    typeof liveCatalogVisibleCount === "number" ? liveCatalogVisibleCount : visibleAssetSet?.size || 0;
  const shellDisabled = (bootState === "unavailable" || bootState === "error") && !hasRenderableLiveCatalog;
  const showRuntimeStatus =
    (bootState === "unavailable" || bootState === "error") && !hasRenderableLiveCatalog;
  const setupStatusState = String(diagnosticsStatus?.state || "").trim().toLowerCase();
  const showSetupStatus = Boolean(
    setupStatusState && setupStatusState !== "ready" && setupStatusState !== "complete",
  );
  const setupStatusToneValue = setupStatusTone(setupStatusState);
  const setupStatusNextStep = diagnosticsAvailable && diagnosticsStatus?.nextStep
    ? `Next step: ${humanizeStatusLabel(diagnosticsStatus.nextStep)}.`
    : diagnosticsAvailable
      ? "Setup diagnostics are being refreshed."
      : "Setup diagnostics have not loaded yet.";
  const inboxItems = Array.isArray(governanceInbox?.items) ? governanceInbox.items : [];
  const inboxUnreadCount = Number.isFinite(Number(governanceInbox?.unreadCount))
    ? Math.max(0, Math.trunc(Number(governanceInbox.unreadCount)))
    : 0;
  const inboxState = String(governanceInbox?.state || "").trim().toLowerCase();
  const showInbox = Boolean(
    governanceInbox &&
    shell?.userEmail &&
    String(shell.userEmail).trim().toLowerCase() !== "unknown",
  );
  const showInboxPanel = showInbox && inboxOpen;
  const inboxTone = inboxStatusTone(inboxState);
  const inboxLabel = inboxStatusLabel(inboxState);
  const inboxMessage =
    String(governanceInbox?.message || "").trim() ||
    "Unread workflow notifications from governance activity.";
  const shellRoleLabel = shell?.role
    ? shell?.roleProvisional
      ? `${shell.role} (verifying)`
      : shell.role
    : "workspace user";
  const accessBanner = workspaceAccessBanner({ workspaceAccess });
  const searchScopeSubject =
    accessBanner?.title === "Workspace-scoped metadata"
      ? "workspace inventory"
      : accessBanner?.title === "No actor identity"
        ? "restricted workspace inventory"
        : "visible assets";
  const searchScopeLabel = hasRenderableLiveCatalog
    ? `${visibleCatalogCount.toLocaleString()} visible asset${visibleCatalogCount === 1 ? "" : "s"} indexed`
    : "Visible catalog unavailable";
  const searchScopeHint = hasRenderableLiveCatalog
    ? accessBanner
      ? `${accessBanner.message} Search covers ${searchScopeSubject}.`
      : `Search covers the workspace inventory visible to the app. Press Enter or Browse to open the full Discovery surface.`
    : "Search is paused until the live catalog becomes available.";
  const searchEnabled = !shellDisabled && searchPanelOpen && searchQuery.trim().length >= 2;
  const shellSearch = useAssetSearch(searchQuery, searchEnabled, searchSeedAssets);

  const topDirectResult =
    searchQuery.trim() && !shellSearch.error ? shellSearch.assets?.[0] || null : null;
  const openSearchResult = (assetFqn) => {
    if (!assetFqn) return;
    setSearchNotice("");
    void openAssetRecordSafely(assetFqn, {
      onNavigationStateChange,
      onOpen: () => {
        setSearchPanelOpen(false);
        onSearchResultSelect?.(assetFqn);
      },
      onUnavailable: () => {
        setSearchPanelOpen(true);
        setSearchNotice(
          "That asset appears in search, but its metadata record is not openable with the current permissions.",
        );
      },
    });
  };
  const openDiscoveryModule = () => {
    onModuleChange?.("discovery");
  };

  useEffect(() => {
    setSearchPanelOpen(false);
    setSearchNotice("");
  }, [activeModule]);

  useEffect(() => {
    if (!diagnosticsOpen) return;
    setSearchPanelOpen(false);
    setSearchNotice("");
  }, [diagnosticsOpen]);

  useEffect(() => {
    if (!searchPanelOpen) return undefined;

    const onPointerDown = (event) => {
      if (!searchRootRef.current?.contains(event.target)) {
        setSearchPanelOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setSearchPanelOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [searchPanelOpen]);

  useEffect(() => {
    const header = shellHeaderRef.current;
    if (!header) return undefined;

    let animationFrame = 0;
    const updateShellHeaderHeight = () => {
      const nextHeight = Math.max(
        0,
        Math.ceil(header.getBoundingClientRect?.().height || header.offsetHeight || 0),
      );
      setShellHeaderHeight((current) => (current === nextHeight ? current : nextHeight));
    };
    const scheduleShellHeaderMeasure = () => {
      if (typeof window === "undefined") {
        updateShellHeaderHeight();
        return;
      }
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateShellHeaderHeight);
    };

    scheduleShellHeaderMeasure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        scheduleShellHeaderMeasure();
      });
      observer.observe(header);
      return () => {
        if (typeof window !== "undefined") {
          window.cancelAnimationFrame(animationFrame);
        }
        observer.disconnect();
      };
    }

    if (typeof window !== "undefined") {
      window.addEventListener("resize", scheduleShellHeaderMeasure);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.cancelAnimationFrame(animationFrame);
        window.removeEventListener("resize", scheduleShellHeaderMeasure);
      }
    };
  }, [
    bootMessage,
    bootState,
    diagnosticsAvailable,
    diagnosticsOpen,
    inboxOpen,
    navigationState?.label,
    navigationState?.pending,
    searchPanelOpen,
    setupStatusNextStep,
    setupStatusState,
    shell?.role,
    shell?.userEmail,
    showInbox,
    showRuntimeStatus,
    showSetupStatus,
  ]);

  const submitSearch = () => {
    if (shellDisabled) return;
    const query = searchQuery.trim();
    if (!query) return;
    if (topDirectResult) {
      setSearchPanelOpen(false);
      void openSearchResult(topDirectResult.fqn);
      return;
    }
    setSearchPanelOpen(false);
    onBrowseCatalog?.(query);
  };

  return (
    <div
      className="gh-app"
      data-shell-sticky-ready={shellHeaderHeight > 0 ? "true" : "false"}
      style={/** @type {import("react").CSSProperties} */ ({
        "--gh-shell-header-height": `${shellHeaderHeight}px`,
      })}
    >
      <header className="gh-shell-header" ref={shellHeaderRef}>
        <div className="gh-shell-topbar">
          <div className="gh-shell-spine">
            <div className="gh-shell-brand-band">
              <button
                className="gh-shell-brand"
                disabled={shellDisabled}
                onClick={openDiscoveryModule}
                type="button"
              >
                <div className="gh-shell-brand-mark" aria-hidden="true">
                  <span className="gh-shell-brand-glyph">GH</span>
                </div>
                <div className="gh-shell-brand-copy">
                  <div className="gh-shell-brand-title">Governance Hub</div>
                  <div className="gh-shell-brand-subtitle">Metadata Workspace</div>
                </div>
              </button>
            </div>

            <div className="gh-shell-nav-band">
              <div className="gh-shell-nav-band-head">
                <div className="gh-shell-module-label">Modules</div>
                <div className="gh-shell-identity-inline">
                  <div className="gh-shell-identity-block">
                    <div className="gh-shell-identity">{shellRoleLabel}</div>
                    <div className="gh-shell-user">{shell?.userEmail || "unknown"}</div>
                  </div>
                  <div className="gh-shell-context-stack">
                    {showRuntimeStatus ? (
                      <div className="gh-shell-context-state">
                        <span className={`gh-chip gh-chip-status tone-${statusTone(bootState)}`}>
                          {statusLabel(bootState)}
                        </span>
                        {bootMessage ? (
                          <div className={`gh-shell-status-note tone-${statusTone(bootState)}`}>{bootMessage}</div>
                        ) : null}
                      </div>
                    ) : null}
                    {showSetupStatus ? (
                      <div className="gh-shell-setup-status">
                        <span className={`gh-chip gh-chip-status tone-${setupStatusToneValue}`}>
                          {setupStatusLabel(setupStatusState)}
                        </span>
                        <div className={`gh-shell-status-note tone-${setupStatusToneValue}`}>
                          {setupStatusNextStep}
                        </div>
                      </div>
                    ) : null}
                    <div className="gh-shell-status-actions">
                      {diagnosticsAvailable ? (
                        <button
                          aria-pressed={diagnosticsOpen}
                          className="gh-tertiary-button gh-inline-link-button"
                          onClick={onToggleDiagnostics}
                          type="button"
                        >
                          {diagnosticsOpen ? "Hide workspace setup" : "Workspace setup"}
                        </button>
                      ) : null}
                      {showInbox ? (
                        <button
                          aria-pressed={inboxOpen}
                          className="gh-tertiary-button gh-inline-link-button gh-shell-inbox-trigger"
                          onClick={onToggleInbox}
                          type="button"
                        >
                          <span>Inbox</span>
                          {inboxUnreadCount > 0 ? (
                            <span aria-hidden="true" className="gh-shell-inbox-badge">
                              {inboxUnreadCount}
                            </span>
                          ) : null}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
              <nav className="gh-shell-nav" aria-label="Primary modules">
                {MODULES.map((module) => (
                  <button
                    className={`gh-product-tab ${activeModule === module.key ? "is-active" : ""}`}
                    disabled={shellDisabled}
                    key={module.key}
                    onClick={module.key === "discovery" ? openDiscoveryModule : () => onModuleChange(module.key)}
                    type="button"
                  >
                    <span>{module.label}</span>
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </div>

        <div className="gh-shell-commandbar">
          <div className="gh-shell-commandbar-copy">
            <div className="gh-shell-module-label">Command bar</div>
            <div className="gh-shell-commandbar-title">
              {`Search ${searchScopeSubject}, then open the broader discovery surface.`}
            </div>
            <div className="gh-shell-commandbar-subtitle">{searchScopeHint}</div>
            <div className="gh-shell-commandbar-scope">{searchScopeLabel}</div>
          </div>
          {navigationState?.pending ? (
            <div className="gh-shell-progress" role="status" aria-live="polite">
              <span className="gh-shell-progress-bar" aria-hidden="true" />
              <span className="gh-shell-progress-copy">
                {navigationState.label || "Opening workspace…"}
              </span>
            </div>
          ) : null}
          <form
            className="gh-global-search gh-global-search-shell"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <div className={`gh-global-search-field ${searchPanelOpen ? "is-open" : ""}`} ref={searchRootRef}>
              <div className="gh-global-search-frame">
                <div className="gh-global-search-copy">
                  <label className="gh-global-search-label" htmlFor="gh-global-search-input">
                    Search
                  </label>
                  <div className="gh-global-search-subtitle">{searchScopeHint}</div>
                </div>
                <div className="gh-global-search-input-wrap">
                  <input
                    className="gh-input gh-global-search-input"
                    disabled={shellDisabled}
                    id="gh-global-search-input"
                    onBlur={() => {
                      if (typeof window === "undefined") return;
                      window.requestAnimationFrame(() => {
                        if (!searchRootRef.current?.contains(document.activeElement)) {
                          setSearchPanelOpen(false);
                        }
                      });
                    }}
                    onChange={(event) => {
                      const next = event.target.value;
                      setSearchQuery(next);
                      setSearchNotice("");
                      setSearchPanelOpen(next.trim().length >= 2);
                    }}
                    onFocus={() => {
                      if (!shellDisabled && searchQuery.trim().length >= 2) {
                        setSearchPanelOpen(true);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setSearchPanelOpen(false);
                    }}
                    placeholder={`Search ${searchScopeSubject} by name, schema, domain, or tag`}
                    value={searchQuery}
                  />
                </div>
                <button className="gh-secondary-button gh-search-submit" disabled={shellDisabled} type="submit">
                  {topDirectResult ? "Open" : "Browse"}
                </button>
              </div>

              {searchEnabled ? (
                <SearchDropdown
                  assets={shellSearch.assets || []}
                  error={shellSearch.error}
                  loading={shellSearch.loading}
                  scopeLabel={searchScopeSubject}
                  notice={searchNotice}
                  onBrowseCatalog={() => submitSearch()}
                  onSelectAsset={(assetFqn) => {
                    void openSearchResult(assetFqn);
                  }}
                  query={searchQuery}
                  topDirectResult={topDirectResult}
                />
              ) : null}
            </div>
          </form>
        </div>
        {accessBanner ? (
          <InlineStatusBanner
            className="gh-shell-access-banner"
            message={accessBanner.message}
            title={accessBanner.title}
            tone={accessBanner.tone}
          />
        ) : null}
      </header>

      {showInboxPanel ? (
        <section className="gh-panel gh-shell-inbox-panel" aria-label="Governance inbox">
          <div className="gh-shell-inbox-head">
            <div className="gh-shell-inbox-title-block">
              <div className="gh-panel-title">Inbox</div>
              <div className="gh-support-copy">{inboxMessage}</div>
            </div>
            <div className="gh-shell-inbox-head-meta">
              <span className={`gh-chip gh-chip-status tone-${inboxTone}`}>{inboxLabel}</span>
              <span className="gh-shell-inbox-count">
                {inboxUnreadCount > 0 ? `${inboxUnreadCount} unread` : "No unread items"}
              </span>
            </div>
          </div>
          {inboxItems.length ? (
            <div className="gh-shell-inbox-list">
              {inboxItems.map((item, index) => {
                const itemState = String(item?.inboxState || "").trim().toLowerCase();
                const itemTone =
                  itemState === "dismissed"
                    ? "bad"
                    : itemState === "read"
                      ? "neutral"
                      : "warn";
                const canMarkRead = itemState !== "read" && itemState !== "dismissed";
                const canDismiss = itemState !== "dismissed";
                return (
                  <article className="gh-shell-inbox-item" key={item.notificationId || `notification-${index}`}>
                    <div className="gh-shell-inbox-item-copy">
                      <div className="gh-shell-inbox-item-title">{item.title || "Notification"}</div>
                      <div className="gh-shell-inbox-item-detail">
                        {item.detail || "No additional detail is available."}
                      </div>
                      <div className="gh-shell-inbox-item-meta">
                        {item.assetLabel || item.assetFqn ? <span>{item.assetLabel || item.assetFqn}</span> : null}
                        {item.createdBy ? <span>{item.createdBy}</span> : null}
                        {item.createdAt ? <span>{item.createdAt}</span> : null}
                      </div>
                    </div>
                    <div className="gh-shell-inbox-item-actions">
                      <span className="gh-chip gh-chip-soft">{humanizeStatusLabel(item.status || "open")}</span>
                      <span className={`gh-chip gh-chip-status tone-${itemTone}`}>
                        {humanizeStatusLabel(item.inboxState || "unread")}
                      </span>
                      <button
                        className="gh-tertiary-button gh-inline-link-button"
                        disabled={!canMarkRead}
                        onClick={() => onInboxItemAction?.(item.notificationId, "read")}
                        type="button"
                      >
                        Mark read
                      </button>
                      <button
                        className="gh-tertiary-button gh-inline-link-button"
                        disabled={!canDismiss}
                        onClick={() => onInboxItemAction?.(item.notificationId, "dismiss")}
                        type="button"
                      >
                        Dismiss
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="gh-shell-inbox-empty">No inbox items are currently available.</div>
          )}
        </section>
      ) : null}

      <main className="gh-main">{children}</main>
    </div>
  );
}
