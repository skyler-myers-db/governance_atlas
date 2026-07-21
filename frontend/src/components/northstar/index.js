/*
 * northstar/ — LEGACY component kit, shrinking wave by wave (COHESION C8
 * deletes the directory). Wave C2 removed the modules orphaned by the
 * HomePage/Insights migration (ActionTile, BarList, DataTable, DonutMetric,
 * HeatmapMatrix, MetricCard, PageHero, RightInspector, SectionCard,
 * Sparkline — the system kit absorbed their contracts). The survivors below
 * still have legacy importers (CdeWorkspace, TaxonomyWorkspace,
 * AdminWorkspace, AuditBrowserWorkspace, AtlasAiDock) and die with their
 * consumers' waves (C4/C5/C6).
 */
export { AtlasAiPanel } from "./AtlasAiPanel";
export { DegradedBanner } from "./DegradedBanner";
export { EmptyState } from "./EmptyState";
export { StatusPill } from "./StatusPill";
