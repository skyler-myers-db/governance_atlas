import { lazy, Suspense, useEffect, useState } from "react";
import { SurfaceHeader, SurfaceTabs } from "./ShellLayoutPrimitives";
import { WorkspaceStateCard } from "./ShellStatePrimitives";

const BulkImportWorkspace = lazy(() => import("./BulkImportWorkspace"));
const CoverageWorkspace = lazy(() => import("./CoverageWorkspace"));
const BrandingWorkspace = lazy(() => import("./BrandingWorkspace"));

const ADMIN_TABS = [
  { key: "bulkImport", label: "Bulk Import" },
  { key: "coverage", label: "Coverage" },
  { key: "branding", label: "Branding" },
];

export default function AdminWorkspace({
  bootstrap,
  onSurfaceReady,
  onNavigationStateChange,
}) {
  const [tab, setTab] = useState("bulkImport");

  useEffect(() => {
    onNavigationStateChange?.({ surface: "admin", tab });
  }, [onNavigationStateChange, tab]);

  useEffect(() => {
    onSurfaceReady?.();
  }, [onSurfaceReady]);

  const shellRole = String(bootstrap?.shell?.role || "").trim();
  const isElevated = /admin|steward/i.test(shellRole);

  return (
    <section className="gh-admin-surface">
      <SurfaceHeader eyebrow="Administration" title="Governance Admin">
        <p className="gh-support-copy">
          Admin-only controls: bulk metadata import, coverage reporting, and
          tenant branding. Server-side actions remain gated to stewards and
          admins even when the surface is reachable to read.
        </p>
      </SurfaceHeader>

      {!isElevated ? (
        <WorkspaceStateCard
          eyebrow="Restricted"
          tone="warn"
          title="Admin actions are gated"
          message="Your current role can view the workspace, but commits and writes require steward or admin permissions."
        />
      ) : null}

      <SurfaceTabs
        ariaLabel="Admin tools"
        activeKey={tab}
        items={ADMIN_TABS}
        onChange={setTab}
        variant="segment"
      />

      <Suspense
        fallback={<div className="gh-support-copy">Loading admin tools…</div>}
      >
        {tab === "bulkImport" ? (
          <BulkImportWorkspace
            bootstrap={bootstrap}
            onNavigationStateChange={onNavigationStateChange}
            onSurfaceReady={onSurfaceReady}
          />
        ) : null}
        {tab === "coverage" ? (
          <CoverageWorkspace
            bootstrap={bootstrap}
            onNavigationStateChange={onNavigationStateChange}
            onSurfaceReady={onSurfaceReady}
          />
        ) : null}
        {tab === "branding" ? (
          <BrandingWorkspace
            bootstrap={bootstrap}
            onNavigationStateChange={onNavigationStateChange}
            onSurfaceReady={onSurfaceReady}
          />
        ) : null}
      </Suspense>
    </section>
  );
}
