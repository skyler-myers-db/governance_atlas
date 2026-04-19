/**
 * Structural identity check: the deployed Discovery UI must be
 * structurally indistinguishable from the OpenMetadata-style mockup
 * (docs/target-discovery.png, referenced by the 2026-04-19 design brief).
 *
 * This is NOT a pixel-diff. It's a trait/hierarchy checklist — every
 * visible region of the mockup is encoded as a DOM/accessibility
 * assertion. The check passes when all traits resolve, fails loudly
 * when any are missing, and prints a per-trait report so the human can
 * see exactly where divergence remains.
 *
 * Usage:
 *   node frontend/scripts/govhub_structural_identity.mjs <base-url>
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const BASE_URL = process.env.GOVHUB_BASE_URL || process.argv[2] || "";
const CDP_URL = process.env.GOVHUB_CDP_URL || "http://127.0.0.1:9223";
const OUT_DIR =
  process.env.GOVHUB_QA_OUT_DIR ||
  path.join(REPO_ROOT, "docs", "screenshots", "identity");

if (!BASE_URL) {
  console.error(
    "Usage: node frontend/scripts/govhub_structural_identity.mjs <base-url>",
  );
  process.exit(1);
}

function urlFor(p) {
  return `${BASE_URL.replace(/\/+$/, "")}${p}`;
}

const traits = [
  // --- Shell ---
  {
    name: "shell: left icon rail present",
    selector: 'aside.gh-side-rail[aria-label="Module rail"]',
  },
  {
    name: "shell: rail has Discovery + Lineage + Governance + Taxonomy + Audit buttons",
    check: async (page) => {
      const labels = [
        "Go to Discovery",
        "Go to Lineage",
        "Go to Governance",
        "Go to Taxonomy",
        "Go to Audit",
      ];
      const present = await Promise.all(
        labels.map((label) =>
          page.locator(`.gh-side-rail button[aria-label="${label}"]`).count(),
        ),
      );
      return present.every((n) => n > 0);
    },
  },
  {
    name: "shell: rail Settings button present",
    selector: '.gh-side-rail button[aria-label="Settings"]',
  },
  {
    name: "topbar: brand (GH / Governance Hub)",
    selector: '.gh-shell-brand',
  },
  {
    name: "topbar: compact global search with Unity-Catalog placeholder",
    check: async (page) => {
      const input = page.locator(".gh-topbar-search-input");
      if (!(await input.count())) return false;
      const placeholder = await input.getAttribute("placeholder");
      return /Search across Databricks Unity Catalog/i.test(placeholder || "");
    },
  },
  {
    name: "topbar: 'Take a ban' header button",
    selector: '.gh-header-action-button-ghost',
  },
  {
    name: "topbar: 'Quick action' header button",
    selector: '.gh-header-action-button-primary',
  },
  {
    name: "topbar: user chip with name + role + avatar",
    check: async (page) => {
      const chip = page.locator(".gh-user-chip");
      if (!(await chip.count())) return false;
      const name = await chip.locator(".gh-user-chip-name").count();
      const role = await chip.locator(".gh-user-chip-role").count();
      const avatar = await chip.locator(".gh-owner-avatar").count();
      return name > 0 && role > 0 && avatar > 0;
    },
  },
  {
    name: "topbar: top module tabs NOT visible (rail is primary nav)",
    check: async (page) => {
      const nav = page.locator(".gh-shell-nav.gh-shell-nav-secondary");
      const count = await nav.count();
      if (count === 0) return false;
      // It should exist in the DOM (for a11y/tests) but be visually clipped
      // via the `clip: rect(0,0,0,0)` sr-only pattern, which makes any
      // descendant button effectively zero-area to the user.
      return await nav.evaluate((el) => {
        const cs = getComputedStyle(el);
        // Visible area collapses to a 1-pixel strip clipped to zero. Width
        // can still reflect the inner-flex layout (so we don't assert on it);
        // the combination of clip+overflow+1-px height is what makes it
        // invisible to the user, which is exactly what the target shows.
        return (
          cs.position === "absolute" &&
          cs.clip === "rect(0px, 0px, 0px, 0px)" &&
          cs.overflow === "hidden" &&
          parseFloat(cs.height) <= 1
        );
      });
    },
  },

  // --- Discovery body: sub-tabs, facet chips, toolbar ---
  {
    name: "discovery: Discovery/Navigation sub-tabs",
    check: async (page) => {
      const d = await page.getByRole("tab", { name: "Discovery" }).count();
      const n = await page.getByRole("tab", { name: "Navigation" }).count();
      return d > 0 && n > 0;
    },
  },
  {
    name: "discovery: primary facet chip row with Tables/Views counts + Filters launcher",
    check: async (page) => {
      const row = page.locator(".gh-primary-facet-row");
      if (!(await row.count())) return false;
      const launcher = row.locator(".gh-primary-facet-launch");
      if (!(await launcher.count())) return false;
      const label = await launcher.innerText();
      if (!/Filters/i.test(label)) return false;
      const hasChips = (await row.locator(".gh-primary-facet-chip").count()) > 0;
      return hasChips;
    },
  },
  {
    name: "discovery: heading 'Discovery' + 'Showing N of M assets'",
    check: async (page) => {
      const h = await page
        .locator(".gh-discovery-command-title")
        .first()
        .innerText();
      const subline = await page
        .locator(".gh-discovery-command-subline")
        .first()
        .innerText();
      return /Discovery|Navigation/i.test(h) && /Showing .* of .* assets/i.test(subline);
    },
  },
  {
    name: "discovery: Best match / sort dropdown",
    selector: 'select.gh-select-sort',
  },
  {
    name: "discovery: Stack Filters button",
    check: async (page) =>
      (await page.getByRole("button", { name: /Stack Filters/i }).count()) > 0,
  },
  {
    name: "discovery: Compact/Normal/Spacious density row",
    check: async (page) => {
      const labels = ["Compact", "Normal", "Spacious"];
      const counts = await Promise.all(
        labels.map((l) =>
          page.getByRole("button", { name: l, exact: true }).count(),
        ),
      );
      return counts.every((n) => n > 0);
    },
  },
  {
    name: "discovery: Copy link button",
    check: async (page) => {
      // The button's visible text is "Copy link" but the accessible name
      // pulls from the longer aria-label. Match by visible text.
      const btn = page.locator("button", { hasText: /^Copy link$/ });
      return (await btn.count()) > 0;
    },
  },

  // --- Sidebar: Filters ---
  {
    name: "sidebar: title 'Filters'",
    check: async (page) => {
      const title = page.locator(".gh-discovery-sidebar .gh-surface-rail-title");
      if (!(await title.count())) return false;
      const text = await title.first().innerText();
      return /Filters/i.test(text);
    },
  },
  {
    name: "sidebar: Catalog section with checkbox + schema rows",
    check: async (page) => {
      const section = page.locator(".gh-catalog-tree");
      if (!(await section.count())) return false;
      const catalogRow = section.locator(".gh-catalog-tree-catalog-row");
      const checkbox = section.locator("input.gh-catalog-tree-checkbox");
      return (await catalogRow.count()) > 0 && (await checkbox.count()) > 0;
    },
  },
  {
    name: "sidebar: Asset Types section with counts",
    check: async (page) => {
      const section = page
        .locator(".gh-surface-rail-section")
        .filter({ hasText: /Asset Types/i })
        .first();
      if (!(await section.count())) return false;
      return (await section.locator(".gh-category-count").count()) > 0;
    },
  },
  {
    name: "sidebar: Domain section",
    check: async (page) =>
      (await page
        .locator(".gh-surface-rail-section")
        .filter({ hasText: /Domain/i })
        .count()) > 0,
  },
  {
    name: "sidebar: Sensitivity section with PII/Confidential/Internal chips",
    check: async (page) => {
      const section = page
        .locator(".gh-surface-rail-section")
        .filter({ hasText: /Sensitivity/i })
        .first();
      if (!(await section.count())) return false;
      const pii = await section.getByRole("button", { name: "PII", exact: true }).count();
      const conf = await section.getByRole("button", { name: "Confidential", exact: true }).count();
      const internal = await section.getByRole("button", { name: "Internal", exact: true }).count();
      return pii > 0 && conf > 0 && internal > 0;
    },
  },
  {
    name: "sidebar: Workflow State section with Published/In Review/Obsolete labels",
    check: async (page) => {
      const section = page
        .locator(".gh-surface-rail-section")
        .filter({ hasText: /Workflow State/i })
        .first();
      if (!(await section.count())) return false;
      const text = await section.innerText();
      return /Published/i.test(text) && /In Review/i.test(text) && /Obsolete/i.test(text);
    },
  },
  {
    name: "sidebar: Owner free-text input",
    selector: 'input.gh-sidebar-input[aria-label*="owner" i]',
  },
  {
    name: "sidebar: Glossary Term free-text input",
    selector: 'input.gh-sidebar-input[aria-label*="glossary" i]',
  },

  // --- Card grid ---
  {
    name: "cards: at least one asset card rendered",
    check: async (page) =>
      (await page.locator(".gh-discovery-asset-card").count()) > 0,
  },
  {
    name: "cards: kind label + icon in header",
    check: async (page) => {
      const card = page.locator(".gh-discovery-asset-card").first();
      return (await card.locator(".gh-discovery-asset-card-kind").count()) > 0;
    },
  },
  {
    name: "cards: favorite star button",
    check: async (page) => {
      const card = page.locator(".gh-discovery-asset-card").first();
      return (await card.locator(".gh-discovery-asset-card-star").count()) > 0;
    },
  },
  {
    name: "cards: more/menu button (⋮)",
    check: async (page) => {
      const card = page.locator(".gh-discovery-asset-card").first();
      return (await card.locator(".gh-discovery-asset-card-more").count()) > 0;
    },
  },
  {
    name: "cards: owner chip (avatar + name) visible",
    check: async (page) => {
      const card = page.locator(".gh-discovery-asset-card").first();
      return (await card.locator(".gh-discovery-asset-owner-chip").count()) > 0;
    },
  },
  {
    name: "cards: workflow state badge (PUBLISHED / IN REVIEW / OBSOLETE)",
    check: async (page) => {
      const card = page.locator(".gh-discovery-asset-card").first();
      const badge = card.locator(".gh-discovery-asset-status");
      if (!(await badge.count())) return false;
      const text = await badge.innerText();
      return /PUBLISHED|IN REVIEW|OBSOLETE/.test(text);
    },
  },
  {
    name: "cards: dual usage metrics (notebook usage + views)",
    check: async (page) => {
      const card = page.locator(".gh-discovery-asset-card").first();
      const usage = card.locator(".gh-discovery-asset-usage-item");
      const count = await usage.count();
      if (count < 2) return false;
      const texts = await Promise.all([
        usage.nth(0).innerText(),
        usage.nth(1).innerText(),
      ]);
      return /notebook/i.test(texts[0]) && /view/i.test(texts[1]);
    },
  },
  {
    name: "cards: coverage / trust pill with percentage",
    check: async (page) => {
      const card = page.locator(".gh-discovery-asset-card").first();
      const trust = card.locator(".gh-discovery-asset-trust");
      if (!(await trust.count())) return false;
      const text = await trust.innerText();
      return /Coverage/i.test(text);
    },
  },
  {
    name: "cards: 2-line description paragraph",
    check: async (page) => {
      const card = page.locator(".gh-discovery-asset-card").first();
      return (
        (await card.locator(".gh-discovery-asset-card-description").count()) > 0
      );
    },
  },

  // --- Preview panel ---
  {
    name: "preview: rail present (SurfaceRail with gh-selection-preview class)",
    selector: '.gh-selection-preview, .gh-asset-preview',
  },
];

async function runTraits(page) {
  const results = [];
  for (const trait of traits) {
    try {
      let ok = false;
      if (trait.check) {
        ok = await trait.check(page);
      } else if (trait.selector) {
        ok = (await page.locator(trait.selector).count()) > 0;
      }
      results.push({ name: trait.name, ok });
    } catch (err) {
      results.push({
        name: trait.name,
        ok: false,
        error: err?.message || String(err),
      });
    }
  }
  return results;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());
    await page.setViewportSize({ width: 1680, height: 1050 });
    await page.goto(urlFor("/discovery"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8000); // wait for catalog to load

    const results = await runTraits(page);
    const pass = results.filter((r) => r.ok).length;
    const fail = results.length - pass;

    // Screenshot before reporting so we can diff against target visually too.
    await page.screenshot({
      fullPage: false,
      path: path.join(OUT_DIR, "identity-snapshot.png"),
      scale: "css",
      type: "png",
    });

    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      total: results.length,
      pass,
      fail,
      results,
    };
    await fs.writeFile(
      path.join(OUT_DIR, "report.json"),
      JSON.stringify(report, null, 2),
    );

    console.log(`\nStructural identity: ${pass}/${results.length} traits matched\n`);
    for (const r of results) {
      console.log(`${r.ok ? "✓" : "✗"}  ${r.name}${r.error ? ` — ${r.error}` : ""}`);
    }
    console.log(`\nReport: ${path.join(OUT_DIR, "report.json")}`);
    console.log(`Screenshot: ${path.join(OUT_DIR, "identity-snapshot.png")}`);

    process.exit(fail === 0 ? 0 : 1);
  } finally {
    try {
      await browser.close();
    } catch {
      /* keep CDP alive */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
