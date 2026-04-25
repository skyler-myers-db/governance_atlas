# North Star Visual Equivalence Rules

Status: active process contract

## Goal

Governance Atlas page work now targets visual equivalence to the approved
North Star reference, or a clearly documented improvement that preserves the
same structure, density, hierarchy, and operating model.

Implemented and deployable is not enough. A page can pass functional tests,
bundle validation, deploy, and smoke screenshots while still failing the visual
contract.

## Required Workflow

1. Identify the target mockup path.
2. Capture or locate the current page screenshot at the nearest matching viewport.
3. Create or update a page checklist under `docs/northstar_gap_analysis/`.
4. Divide every visible gap into:
   - `Must match now`
   - `Can render unavailable/degraded`
   - `Explicitly deferred`
5. Implement only against that checklist.
6. Capture a new current screenshot after implementation.
7. Run side-by-side review with subagent coverage.
8. Update the checklist with pass/fail evidence.
9. Only then summarize completion.

## Hard Gates

- The reference screenshot is the contract.
- Smoke screenshots are not visual QA.
- Nonblank page checks are not visual QA.
- Unit tests and build success are not visual QA.
- Bundle validation and deploy success are not visual QA.
- Visual completion requires a side-by-side audit against the mockup.
- Every page-level visual pass must have a checklist file.
- Every unresolved must-match gap blocks visual completion.
- Any deferral must name the reason and follow-up needed.

## Truth Rules

- Preserve the target layout even when live data is thin.
- Show unavailable, empty, degraded, or pending states inside the target panel
  rather than replacing the panel with a different layout.
- Never invent workflow counters, fake tasks, fake lineage, fake governance
  state, fake quality signals, fake control coverage, or fake AI evidence.
- If a mockup metric has no authoritative source yet, keep the card shape and
  mark the value unavailable or degraded.
- If a chart has no live series yet, keep the chart frame and render an
  intentional unavailable/empty chart state.

## Required Subagent Reviews

Every non-trivial visual tranche must use these roles before final acceptance:

- `visual fidelity`: compares current screenshot to the reference and blocks
  completion on layout, spacing, density, palette, typography, card, or missing
  region drift.
- `product structure`: checks that hierarchy, grouping, and user workflow match
  the target operating model.
- `truth/provenance`: checks that data claims remain live-backed, unavailable,
  or degraded instead of synthetic.
- `regression/ripple`: checks adjacent shell, routing, responsive behavior,
  tests, and shared component effects.

## Final Evidence Required

Each tranche closeout must record:

- target mockup path
- current screenshot path
- checklist path
- viewport used for comparison
- open must-match gap count
- explicit deferrals
- validation commands run
- subagent roles used and material findings
