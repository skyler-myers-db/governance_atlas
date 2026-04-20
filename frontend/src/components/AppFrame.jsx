import { useEffect, useRef, useState } from "react";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { openAssetRecordSafely } from "../lib/assetRecordNavigation";
import { workspaceAccessBanner } from "../lib/capabilities";
import { InlineStatusBanner } from "./ShellStatePrimitives";
import { GlobalHeader } from "./primitives/GlobalHeader";
import { TopbarSearch } from "./primitives/TopbarSearch";
import { InboxPanel } from "./primitives/InboxPanel";
import { CommandPalette } from "./primitives/CommandPalette";
import { SideIconRail } from "./primitives/SideIconRail";
import { humanizeStatusLabel } from "./primitives/shellStatusLabels";

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
  const [commandOpen, setCommandOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const shellHeaderRef = useRef(null);
  const searchRootRef = useRef(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    // Light cream theme is the only supported theme for now — operator
    // 2026-04-19 round 3 removed the dark-mode toggle. Pin the
    // data-theme attribute so any remaining dark-mode CSS stays inert.
    document.documentElement.setAttribute("data-theme", "light");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onKey = (event) => {
      const modKey = event.metaKey || event.ctrlKey;
      if (modKey && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        setCommandOpen((c) => !c);
      } else if (event.key === "/" && !(document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA")) {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    // Let inner surfaces (e.g. the Discovery sub-tab Quick action button)
    // open the palette without prop drilling through the children tree.
    const onOpenPalette = () => setCommandOpen(true);
    window.addEventListener("gh:open-command-palette", onOpenPalette);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("gh:open-command-palette", onOpenPalette);
    };
  }, []);
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
  const setupStatusNextStep = diagnosticsAvailable && diagnosticsStatus?.nextStep
    ? `Next step: ${humanizeStatusLabel(diagnosticsStatus.nextStep)}.`
    : diagnosticsAvailable
      ? "Setup diagnostics are being refreshed."
      : "Setup diagnostics have not loaded yet.";
  const inboxUnreadCount = Number.isFinite(Number(governanceInbox?.unreadCount))
    ? Math.max(0, Math.trunc(Number(governanceInbox.unreadCount)))
    : 0;
  // Show the inbox chrome as soon as we know who the signed-in user is,
  // and let the panel open even when the governance summary hasn't
  // arrived yet — InboxPanel renders a proper empty/degraded state.
  // Operator 2026-04-19 flagged the old "click does nothing" behavior.
  const showInbox = Boolean(
    shell?.userEmail &&
    String(shell.userEmail).trim().toLowerCase() !== "unknown",
  );
  const showInboxPanel = showInbox && inboxOpen;
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

  const handleSignOut = () => {
    if (typeof window === "undefined") return;
    const proceed = typeof window.confirm === "function"
      ? window.confirm(
          "Sign out?\n\nGovernance Hub uses your Databricks workspace login. Continuing opens the Databricks sign-out page in a new tab.",
        )
      : true;
    if (!proceed) return;
    const { protocol, hostname } = window.location;
    const workspaceHost = hostname.replace(/^[^.]+\./, "").replace(/databricksapps\.com$/, "databricks.net");
    const signOutUrl = `${protocol}//${workspaceHost}/login.html?action=logOut`;
    window.open(signOutUrl, "_blank", "noopener,noreferrer");
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
      className="gh-app gh-app-with-rail"
      data-shell-sticky-ready={shellHeaderHeight > 0 ? "true" : "false"}
      style={/** @type {import("react").CSSProperties} */ ({
        "--gh-shell-header-height": `${shellHeaderHeight}px`,
      })}
    >
      <SideIconRail
        activeModule={activeModule}
        onModuleChange={onModuleChange}
        onOpenSettings={onToggleDiagnostics}
        onSignOut={handleSignOut}
        shellDisabled={shellDisabled}
        shellDisabledReason={shellDisabledReason}
      />
      <header className="gh-shell-header" ref={shellHeaderRef}>
        <GlobalHeader
          shell={shell}
          shellDisabled={shellDisabled}
          shellDisabledReason={shellDisabledReason}
          activeModule={activeModule}
          onOpenDiscovery={openDiscoveryModule}
          onModuleChange={onModuleChange}
          showRuntimeStatus={showRuntimeStatus}
          bootState={bootState}
          bootMessage={bootMessage}
          showSetupStatus={showSetupStatus}
          setupStatusState={setupStatusState}
          setupStatusNextStep={setupStatusNextStep}
          diagnosticsAvailable={diagnosticsAvailable}
          diagnosticsOpen={diagnosticsOpen}
          onToggleDiagnostics={onToggleDiagnostics}
          showInbox={showInbox}
          inboxOpen={inboxOpen}
          inboxUnreadCount={inboxUnreadCount}
          onToggleInbox={onToggleInbox}
          alertsOpen={alertsOpen}
          alertsUnreadCount={0}
          onToggleAlerts={() => setAlertsOpen((current) => !current)}
          onOpenSettings={onToggleDiagnostics}
          onSignOut={handleSignOut}
          onOpenCommandPalette={() => setCommandOpen(true)}
          topbarSearchSlot={(
            <TopbarSearch
              searchRootRef={searchRootRef}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              searchPanelOpen={searchPanelOpen}
              onSearchPanelOpenChange={setSearchPanelOpen}
              onSubmit={submitSearch}
              shellDisabled={shellDisabled}
              shellDisabledReason={shellDisabledReason}
              searchEnabled={searchEnabled}
              searchAssets={shellSearch.assets || []}
              searchError={shellSearch.error}
              searchLoading={shellSearch.loading}
              searchNotice={searchNotice}
              onSearchNoticeReset={() => setSearchNotice("")}
              onSelectAsset={(assetFqn) => {
                void openSearchResult(assetFqn);
              }}
              topDirectResult={topDirectResult}
            />
          )}
        />
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

      {alertsOpen ? (
        <div className="gh-alerts-panel" role="dialog" aria-label="Alerts">
          <div className="gh-alerts-panel-head">
            <span className="gh-alerts-panel-title">Alerts</span>
            <button
              aria-label="Close alerts"
              className="gh-alerts-panel-close"
              onClick={() => setAlertsOpen(false)}
              type="button"
            >
              ×
            </button>
          </div>
          <div className="gh-alerts-panel-body">
            <p className="gh-support-copy">
              No governance alerts in the last 24 hours. Steward follow-ups,
              broken lineage edges, and quality breaches will appear here
              when they fire.
            </p>
          </div>
        </div>
      ) : null}

      <main className="gh-main">{children}</main>

      {/* ⌘K hint pill in the bottom-right. The floating dark-mode
          toggle was removed 2026-04-19 round 3 — operator asked for
          the light cream theme to persist across all pages, and the
          moon icon was getting flagged as visual noise on an
          otherwise cream-only surface. */}
      <div className="gh-app-footer-controls">
        <button
          aria-label="Open command palette"
          className="gh-cmdk-hint-pill"
          onClick={() => setCommandOpen(true)}
          title="Open command palette (⌘K)"
          type="button"
        >
          <kbd>⌘</kbd>
          <kbd>K</kbd>
        </button>
      </div>

      {commandOpen ? (
        <CommandPalette
          assets={searchSeedAssets}
          navigate={({ surface, fqn }) => {
            setCommandOpen(false);
            if (surface === "entity" && fqn) {
              onSearchResultSelect?.(fqn);
              return;
            }
            onModuleChange?.(surface);
          }}
          onClose={() => setCommandOpen(false)}
        />
      ) : null}
    </div>
  );
}
