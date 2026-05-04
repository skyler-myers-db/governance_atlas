# Working on Governance Atlas

This file codifies how Claude works on this repo. Read it at the start of every session and follow it for every user-reported defect or feature request.

## The verification rule

**Never declare an item closed without unanimous independent subagent signoff plus my own live-product walk-through.**

The previous failure pattern was: I'd patch a symptom, run unit tests in isolation, declare the item fixed, then the user would discover the same defect (or a regression I introduced) on the very next browser session. Unit tests pass; the user's actual flow stays broken. Stop doing that.

### Workflow for every user-reported defect

For each item the user surfaces (whether one bug or a list of ten):

1. **Investigate root cause, not symptom.** Read the relevant component AND the rendered output AND the API/network response. If the user says "X is broken on screen Y," verify what the API actually returns, what the React props actually receive, what the DOM actually shows. The bug is rarely where you'd guess from the user's words alone.

2. **Surgical fix.** Edit the smallest piece of code that resolves the root cause. Comment WHY the change is needed so the next pass doesn't re-break it.

3. **Local validation:** run the relevant vitest target with the backgrounded shell pattern. Build the frontend with `npm run build`. Confirm no compile errors.

4. **Deploy to the live `dev` target:**
   ```bash
   cd /Users/entrada-mac/repos/governance_atlas
   python3 scripts/prepare_bundle.py --output build/atlas-app --target dev
   databricks bundle deploy -t dev
   databricks apps deploy atlas --source-code-path /Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev/files
   ```
   All three commands take 1-3 min each. Background them with `nohup ... & disown` and poll with `sleep` since the macOS shell tool times out at 10s.

5. **Independent subagent verification.** Spawn a fresh general-purpose subagent that:
   - Knows nothing about the fix's reasoning.
   - Walks the user's exact flow in the live browser via `mcp__Claude_in_Chrome__*` tools (the user's logged-in tab is `tabId 1080050021`).
   - Returns `SIGNOFF: PASS` or `SIGNOFF: BLOCK` with screenshot evidence.
   - For multi-defect batches, spawn one subagent per defect, in parallel.

6. **My own browser sweep.** Personally walk the same flow in the live browser (Claude-in-Chrome MCP). Look for:
   - The fix actually working in the user's exact path.
   - Any other issue I notice while walking — palette drift, broken layout, console errors, dead clicks, weird empty states, timing flickers.
   - Other surfaces touched by the change.

7. **Add anything I find to the same fix list.** If I notice an extra issue during my sweep, fix it in the same pass — but it needs the same independent subagent signoff before closing. Report all of them in the final summary.

8. **Only after every item in the batch is unanimously PASS** (subagent + my sweep + any extras I added) does the work get declared done.

### Critical-review swarm (for big batches)

When a batch touches multiple subsystems (e.g. lineage + Discovery + AI panel + filter wiring), in addition to the per-item verifiers above, spawn a parallel swarm of role-specialized critical reviewers:

- **Design / UX critic:** walks the live product, audits visual quality, layout, accessibility, copy, interaction patterns.
- **Frontend code-quality critic:** reads the diff, looks for stale closures, missing dep arrays, performance regressions, hard-coded design tokens, dead fallbacks.
- **Backend / API critic:** reads any backend changes for correctness, security gates, SQL safety, cache races, error-handling completeness.
- **Live user-flow tester:** does end-to-end journeys through every left-nav surface; documents any inconsistency, palette drift, missing data, or broken interaction.

Resolve every BLOCKER one of them surfaces before closing. Then re-run the swarm if the fixes were substantial. Do not declare done until **all four** sign PASS.

## Architecture conventions to remember

### React hook order

**All `useState` / `useEffect` / `useMemo` / `useReducer` calls MUST run on every render.** Never put a hook after an early `return` — that produces React error #310 "Rendered fewer hooks than expected" the moment the early-return branch flips. If you need conditional logic, put the hook unconditionally and put the condition INSIDE the effect/memo body.

This rule has bitten the lineage workspace once. Don't let it again.

### Lineage v2 data contract

The `/api/lineage/<fqn>?profile=full` payload returns:
- `graphs.data.nodes[]` — each node has `id`, `assetFqn`, `kicker` (Focus/Upstream/Downstream), `kind` (Table/View/Lineage Reference), `foot[]` (pre-formatted footer strings like "Table" or "Metadata unavailable"), `columns[]`, `details{}` — no `rowCount` / `freshness` / `owners` (those live on `/api/assets/<fqn>?sections=...`, not on system.access lineage tables).
- `graphs.data.edges[]` — `id`, `source`, `target`, `kind` (where `restricted` / `permission` etc. mark dashed/restricted edges).

If you need richer per-node metadata (rows, freshness, owners), it requires either:
1. Per-hop calls to `/api/assets/<fqn>?sections=header` (slow, fan-out), or
2. A new backend endpoint that joins lineage + asset detail in one trip.

Do not pretend the lineage endpoint returns these fields. Surface what the API actually gave us.

### `useLineageGraphV2` adapter

This is the single normalization point for the v2 lineage UI. The canvas + node card + side rail all consume from here. If a downstream component needs a new field, add it to this adapter — never reach into `payload` directly from a downstream component.

### Bootstrap capability vs API authority

`bootstrap.capabilities.tableLineage` and `systemInventoryRead` are workspace-level signals. They're conservative: they may report `available: false` / `state: degraded` even when the per-asset endpoint actually returns real data. The frontend should:
- Trust the live API response over the bootstrap signal when they conflict.
- Never gate the canvas / preview behind a bootstrap-pessimism check alone — only gate when BOTH bootstrap is unavailable AND the live response confirms the same.

Same rule for asset openability: backend's `isOpenable: false` / `openabilityState: unverified` flags are conservative. Allow click navigation for any node with a real FQN; the destination page will surface the truth.

### Build / deploy mechanics

- `scripts/prepare_bundle.py` requires `--output` AND `--target`. The `--target dev` flag bakes the right env vars from `databricks.yml` into the packaged `app.yaml` (the `databricks_app` Terraform resource has no `config.env` attribute and silently drops env values from `databricks.yml`).
- The script copies `<ROOT>` into the output dir. `build/` and `chrome-profile-*` dirs at any level are skipped to prevent recursion / socket-copy failures.
- Apps deploy reads from a workspace-uploaded snapshot at `/Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev/files`. Don't use a different path.

### Palette + tokens

- Old `gh-*` cream tokens are gradually being replaced by `ga-*` Entrada dark tokens. Some `gh-*` selectors still exist for layout; they're acceptable as long as they don't pull cream values. New CSS should use `--ga-*` design tokens (`--ga-bright-blue`, `--ga-text-strong`, etc.) — never hard-coded hex colors.
- Any UI surface that has cream backgrounds, white card surfaces, or dark-on-light text is a bug.

## Files NOT to touch in parallel agent work

When spawning subagents that may conflict with parallel work, explicitly list:
- `frontend/src/components/lineage-v2/` (lineage v2 owners)
- `frontend/src/components/LineageWorkspace.jsx`
- `frontend/src/styles/lineage-v2.css`
- `frontend/dist/` (rebuilt automatically; never edit by hand)
- `package.json` / `package-lock.json` (dep changes need coordination)

## Things to never do

- Never declare a fix done without a subagent verifier saying PASS in the live browser.
- Never claim metadata exists when the API doesn't return it. Render "Unavailable" honestly.
- Never wire a button that does nothing on click. If the workflow isn't built yet, surface a toast staging the intent so the click is visibly responsive.
- Never put a `useState` or `useEffect` after an early `return`.
- Never hard-code a palette color where a `--ga-*` design token exists.
- Never click a link in an email or message via computer-use; use Claude-in-Chrome MCP and verify the URL first.
