import { useEffect, useRef, useState } from "react";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { openAssetRecordSafely } from "../lib/assetRecordNavigation";
import { workspaceAccessBanner } from "../lib/capabilities";
import { InlineStatusBanner } from "./ShellStatePrimitives";
import { GlobalSearchDropdown } from "./primitives/GlobalSearchDropdown";
import { InboxPanel } from "./primitives/InboxPanel";
import {
  humanizeStatusLabel,
  setupStatusLabel,
  setupStatusTone,
  statusLabel,
  statusTone,
} from "./primitives/shellStatusLabels";

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
  const shellDisabledReason = shellDisabled
    ? bootMessage
      || (bootState === "error"
        ? "The live catalog failed to load. Complete workspace setup or retry to re-enable navigation."
        : "The live catalog is not available yet. Complete workspace setup to re-enable navigation.")
    : undefined;
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
  const inboxUnreadCount = Number.isFinite(Number(governanceInbox?.unreadCount))
    ? Math.max(0, Math.trunc(Number(governanceInbox.unreadCount)))
    : 0;
  const showInbox = Boolean(
    governanceInbox &&
    shell?.userEmail &&
    String(shell.userEmail).trim().toLowerCase() !== "unknown",
  );
  const showInboxPanel = showInbox && inboxOpen;
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
    ? `${visibleCatalogCount.toLocaleString()} visible asset${visibleCatalogCount === 1 ? "" : "s"} in scope`
    : "Visible catalog unavailable";
  const searchScopeHint = hasRenderableLiveCatalog
    ? accessBanner?.message || ""
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
                title={shellDisabledReason}
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
                    title={shellDisabledReason}
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
            {searchScopeHint ? (
              <div className="gh-shell-commandbar-subtitle">{searchScopeHint}</div>
            ) : null}
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
                </div>
                <div className="gh-global-search-input-wrap">
                  <input
                    aria-describedby={shellDisabled ? "gh-global-search-disabled-note" : undefined}
                    className="gh-input gh-global-search-input"
                    disabled={shellDisabled}
                    id="gh-global-search-input"
                    title={shellDisabledReason}
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
                <button
                  className="gh-secondary-button gh-search-submit"
                  disabled={shellDisabled}
                  title={shellDisabledReason}
                  type="submit"
                >
                  {topDirectResult ? "Open" : "Browse"}
                </button>
                {shellDisabledReason ? (
                  <span
                    id="gh-global-search-disabled-note"
                    style={{
                      position: "absolute",
                      width: 1,
                      height: 1,
                      padding: 0,
                      margin: -1,
                      overflow: "hidden",
                      clip: "rect(0,0,0,0)",
                      whiteSpace: "nowrap",
                      border: 0,
                    }}
                  >
                    {shellDisabledReason}
                  </span>
                ) : null}
              </div>

              {searchEnabled ? (
                <GlobalSearchDropdown
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
        <InboxPanel governanceInbox={governanceInbox} onInboxItemAction={onInboxItemAction} />
      ) : null}

      <main className="gh-main">{children}</main>
    </div>
  );
}
