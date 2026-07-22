/*
 * App.jsx — providers + shell + routes (Wave B1, COHESION_BLUEPRINT Wave B).
 *
 * The former 1,172-line god component (13-branch surface switch, lifted
 * discovery/governance state buses, seed-merging engine, inbox-badge
 * computer, nav-pending state machine) is gone:
 *   - routing lives in app-shell/SurfaceRoutes.jsx, generated from
 *     nav/routes.js ROUTES with alias redirects via resolveUrl,
 *   - shell chrome + boot gating live in app-shell/AppShell.jsx,
 *   - bootstrap/runtime merging lives in app-shell/useShellRuntime.js,
 *   - the drilled navigation callbacks live in app-shell/legacyAdapters.js.
 */

import AppShell from "./app-shell/AppShell.jsx";
import SurfaceRoutes from "./app-shell/SurfaceRoutes.jsx";

export default function App() {
  return (
    <AppShell>
      <SurfaceRoutes />
    </AppShell>
  );
}
