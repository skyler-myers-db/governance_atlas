/**
 * Structural identity check v2: Discovery UI must be structurally
 * indistinguishable from the target OM-style mockup. One trait per
 * mismatch-catalog item from the 51-point audit (see
 * docs/RECONSTRUCTION_PLAN.md identity section).
 *
 * This is NOT a pixel diff — it's a DOM/a11y assertion suite. Every
 * trait is either a presence check, an absence check, or a computed
 * predicate on text / attribute / style.
 *
 * Usage:
 *   node frontend/scripts/govhub_structural_identity.mjs <base-url>
 *
 * Exit 0 iff every critical trait passes.
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

// severity: "critical" fails the run; "cosmetic" is reported but doesn't
// gate. Default critical.
const traits = [
  // ─────── TOP BAR (items 1–6) ───────
  {
    id: "topbar.brand-mark-sigma",
    name: "Top bar: sigma/magenta brand mark (not GH block)",
    check: async (page) => {
      const mark = page.locator(".gh-shell-brand-mark svg");
      if (!(await mark.count())) return false;
      const color = await mark.first().evaluate((el) => getComputedStyle(el).color);
      // Match any magenta-ish color (rgb(225, 29, 116) = #e11d74)
      return /rgb\((22[0-9]|2[3-5][0-9]),\s*\d+,\s*\d+\)/.test(color);
    },
  },
  {
    id: "topbar.no-metadata-workspace-subtitle",
    name: "Top bar: 'Metadata Workspace' subtitle is absent",
    check: async (page) =>
      (await page.locator(".gh-shell-brand-subtitle:visible").count()) === 0,
  },
  {
    id: "topbar.no-take-a-ban-button",
    name: "Top bar: 'Take a ban' / 'Take as ban' header button absent",
    check: async (page) =>
      (await page.locator(".gh-header-action-button-ghost").count()) === 0,
  },
  {
    id: "topbar.no-quick-action-button",
    name: "Top bar: 'Quick action' header button absent",
    check: async (page) =>
      (await page.locator(".gh-header-action-button-primary").count()) === 0,
  },
  {
    id: "topbar.bell-visible",
    name: "Top bar: bell icon always visible with unread dot",
    check: async (page) => {
      const bell = page.locator(".gh-user-chip-bell");
      if (!(await bell.count())) return false;
      const dot = bell.locator(".gh-user-chip-bell-dot");
      return (await dot.count()) > 0;
    },
  },
  {
    id: "topbar.search-wide",
    name: "Top bar: search field is hero-wide (>= 400px)",
    check: async (page) => {
      const field = page.locator(".gh-topbar-search").first();
      if (!(await field.count())) return false;
      const width = await field.evaluate((el) => el.getBoundingClientRect().width);
      return width >= 400;
    },
  },
  {
    id: "topbar.search-placeholder",
    name: "Top bar: search placeholder matches target copy",
    check: async (page) => {
      const input = page.locator(".gh-topbar-search-input").first();
      const placeholder = await input.getAttribute("placeholder");
      return /Search across Databricks Unity Catalog, tables, views, and metrics/i.test(
        placeholder || "",
      );
    },
  },
  {
    id: "topbar.no-setup-attention-banner",
    name: "Top bar: 'Setup attention' banner not rendered inline",
    check: async (page) =>
      (await page.getByText(/^Setup attention$/).count()) === 0,
  },
  {
    id: "topbar.user-chip",
    name: "Top bar: user chip with name + role + avatar",
    check: async (page) => {
      const chip = page.locator(".gh-user-chip");
      if (!(await chip.count())) return false;
      const hasName = (await chip.locator(".gh-user-chip-name").count()) > 0;
      const hasRole = (await chip.locator(".gh-user-chip-role").count()) > 0;
      const hasAvatar = (await chip.locator(".gh-owner-avatar").count()) > 0;
      return hasName && hasRole && hasAvatar;
    },
  },

  // ─────── LEFT RAIL (items 7–8) ───────
  {
    id: "rail.present",
    name: "Rail: left icon rail present",
    selector: 'aside.gh-side-rail[aria-label="Module rail"]',
  },
  {
    id: "rail.core-icons",
    name: "Rail: core target set (Home + Discovery + Activity + Team)",
    check: async (page) => {
      const labels = ["Go to Home", "Go to Discovery", "Go to Activity", "Go to Team"];
      for (const l of labels) {
        if ((await page.locator(`.gh-side-rail button[aria-label="${l}"]`).count()) === 0) {
          return false;
        }
      }
      return true;
    },
  },
  {
    id: "rail.settings-logout",
    name: "Rail: footer has Settings + Sign out",
    check: async (page) => {
      const s = await page.locator('.gh-side-rail button[aria-label="Settings"]').count();
      const l = await page.locator('.gh-side-rail button[aria-label="Sign out"]').count();
      return s > 0 && l > 0;
    },
  },
  {
    id: "rail.active-magenta",
    name: "Rail: active indicator uses magenta accent",
    check: async (page) => {
      const active = page.locator(".gh-side-rail-button.is-active").first();
      if (!(await active.count())) return false;
      const shadow = await active.evaluate((el) => getComputedStyle(el).boxShadow);
      // inset magenta left bar
      return /rgb\((21[0-9]|22[0-9]|2[3-5][0-9]),\s*\d+,\s*\d+\)/.test(shadow);
    },
  },

  // ─────── ACTIVE FACET CHIP ROW (items 9–11) ───────
  {
    id: "chips.tables-views-columns-banonns",
    name: "Chip row: Tables / Views / Columns / Banonns chips all visible",
    check: async (page) => {
      const row = page.locator(".gh-primary-facet-row");
      if (!(await row.count())) return false;
      const text = await row.innerText();
      return /Tables/.test(text) && /Views/.test(text) && /Columns/.test(text) && /Banonns/i.test(text);
    },
  },
  {
    id: "chips.filters-launcher",
    name: "Chip row: 'Filters' launcher button (Stack Filters aria-label)",
    check: async (page) =>
      (await page.getByRole("button", { name: /Stack Filters/i }).count()) > 0,
  },
  {
    id: "chips.filter-glyph",
    name: "Chip row: Filters launcher uses two-column-bar glyph",
    check: async (page) => {
      const launcher = page.locator(".gh-primary-facet-launch svg path");
      if (!(await launcher.count())) return false;
      const d = await launcher.first().getAttribute("d");
      return /M4 6h16M7 12h10M10 18h4/.test(d || "");
    },
  },

  // ─────── SUB TABS (item 12) ───────
  {
    id: "subtabs.underline-style",
    name: "Sub-tabs: underline style (not pill track)",
    check: async (page) => {
      const row = page.locator(".gh-sub-tab-row");
      if (!(await row.count())) return false;
      const bg = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
      // transparent or rgba alpha=0 means no pill track
      return /rgba?\(0,\s*0,\s*0,\s*0\)|transparent/.test(bg);
    },
  },
  {
    id: "subtabs.discovery-and-navigation",
    name: "Sub-tabs: Discovery + Navigation tabs present",
    check: async (page) => {
      const d = await page.getByRole("tab", { name: "Discovery" }).count();
      const n = await page.getByRole("tab", { name: "Navigation" }).count();
      return d > 0 && n > 0;
    },
  },

  // ─────── DISCOVERY HEADER (items 13–15) ───────
  {
    id: "header.sort-by-label",
    name: "Header: 'Sort by' label next to dropdown",
    check: async (page) => {
      const label = page.locator(".gh-discovery-sort-inline .gh-field-label").first();
      if (!(await label.count())) return false;
      const text = await label.innerText();
      return /Sort by/i.test(text);
    },
  },
  {
    id: "header.relevance-option",
    name: "Header: sort dropdown contains 'Relevance' option",
    check: async (page) => {
      const values = await page
        .locator("select.gh-select-sort option")
        .evaluateAll((opts) => opts.map((o) => o.value));
      return values.some((v) => /relevance/i.test(v));
    },
  },
  {
    id: "header.no-stack-filters-button",
    name: "Header: no inline 'Stack Filters' button in the command toolbar (launcher moved to chip row)",
    check: async (page) =>
      (await page.locator(".gh-discovery-stack-trigger").count()) === 0,
  },
  {
    id: "header.no-density-toggle",
    name: "Header: Compact/Normal/Spacious density toggle removed",
    check: async (page) =>
      (await page.locator(".gh-discovery-density-toggle").count()) === 0,
  },
  {
    id: "header.no-copy-link-button",
    name: "Header: inline Copy link button removed",
    check: async (page) =>
      (await page.locator("button", { hasText: /^Copy link$/ }).count()) === 0,
  },

  // ─────── CARD GRID (items 16–25) ───────
  {
    id: "cards.grid-3-columns",
    name: "Cards: 3-column grid at >= 1440px",
    check: async (page) => {
      const grid = page.locator(".gh-discovery-card-list").first();
      if (!(await grid.count())) return false;
      const template = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
      // three tracks
      const tracks = template.split(/\s+/).filter((x) => /px|fr|\d/.test(x));
      return tracks.length === 3;
    },
  },
  {
    id: "cards.generic-kind-label",
    name: "Cards: kind label reads 'Table/View' (generic)",
    check: async (page) => {
      const kind = page.locator(".gh-discovery-asset-card-kind").first();
      if (!(await kind.count())) return false;
      const text = (await kind.innerText()).trim();
      return text === "Table/View";
    },
  },
  {
    id: "cards.domain-pill-always",
    name: "Cards: domain pill always rendered",
    check: async (page) => {
      const cards = await page.locator(".gh-discovery-asset-card").count();
      if (!cards) return false;
      const pills = await page.locator(".gh-discovery-asset-card .gh-discovery-asset-pill-domain").count();
      return pills >= cards;
    },
  },
  {
    id: "cards.owner-chip-always",
    name: "Cards: owner chip with avatar + name always rendered",
    check: async (page) => {
      const cards = await page.locator(".gh-discovery-asset-card").count();
      if (!cards) return false;
      const chips = await page.locator(".gh-discovery-asset-card .gh-discovery-asset-owner-chip").count();
      return chips >= cards;
    },
  },
  {
    id: "cards.three-tag-row",
    name: "Cards: three-tag row (PII/Transaction/Critical or equivalents)",
    check: async (page) => {
      const card = page.locator(".gh-discovery-asset-card").first();
      if (!(await card.count())) return false;
      const tags = await card.locator(".gh-discovery-asset-tag").count();
      return tags >= 3;
    },
  },
  {
    id: "cards.workflow-badge-visible",
    name: "Cards: workflow state badge (PUBLISHED/IN REVIEW/OBSOLETE)",
    check: async (page) => {
      const card = page.locator(".gh-discovery-asset-card").first();
      const badge = card.locator(".gh-discovery-asset-status");
      if (!(await badge.count())) return false;
      const text = await badge.innerText();
      return /PUBLISHED|IN REVIEW|OBSOLETE/.test(text);
    },
  },
  {
    id: "cards.high-trust-label",
    name: "Cards: trust pill uses 'High Trust / Mid Trust / Low Trust' copy",
    check: async (page) => {
      const card = page.locator(".gh-discovery-asset-card").first();
      const trust = card.locator(".gh-discovery-asset-trust");
      if (!(await trust.count())) return false;
      const text = await trust.innerText();
      return /(High|Mid|Low) Trust \d{1,3}%/.test(text);
    },
  },
  {
    id: "cards.usage-notebook-and-views",
    name: "Cards: usage row has both notebook usage + views",
    check: async (page) => {
      const card = page.locator(".gh-discovery-asset-card").first();
      const usage = card.locator(".gh-discovery-asset-card-usage");
      if (!(await usage.count())) return false;
      const text = await usage.innerText();
      return /notebook/i.test(text) && /view/i.test(text);
    },
  },
  {
    id: "cards.no-footer",
    name: "Cards: no 'Updated …' footer",
    check: async (page) => {
      const footer = page.locator(".gh-discovery-asset-card-foot");
      if (!(await footer.count())) return true; // absent is fine
      const visible = await footer.first().evaluate((el) => getComputedStyle(el).display);
      return visible === "none";
    },
  },

  // ─────── SIDEBAR (items 26–38) ───────
  {
    id: "sidebar.title-filters-only",
    name: "Sidebar: heading is plain 'Filters'",
    check: async (page) => {
      const title = page.locator(".gh-filters-rail-title");
      if (!(await title.count())) return false;
      const text = await title.first().innerText();
      return text.trim() === "Filters";
    },
  },
  {
    id: "sidebar.section-chevrons",
    name: "Sidebar: every section header has a collapse chevron",
    check: async (page) => {
      const sections = await page.locator(".gh-sidebar-section-toggle").count();
      const chevrons = await page.locator(".gh-sidebar-section-chevron").count();
      return sections > 0 && chevrons >= sections;
    },
  },
  {
    id: "sidebar.catalog-at-top",
    name: "Sidebar: Catalog section is the first section",
    check: async (page) => {
      const first = page.locator(".gh-discovery-sidebar .gh-sidebar-section-toggle").first();
      if (!(await first.count())) return false;
      const text = await first.innerText();
      return /Catalog/i.test(text);
    },
  },
  {
    id: "sidebar.catalog-auto-expand",
    name: "Sidebar: first catalog row auto-expanded (schema rows visible)",
    check: async (page) => {
      const schemas = await page.locator(".gh-catalog-tree-schema-row").count();
      return schemas > 0;
    },
  },
  {
    id: "sidebar.asset-type-checkboxes",
    name: "Sidebar: Asset Type rows rendered as checkboxes with (count)",
    check: async (page) => {
      const section = page
        .locator(".gh-surface-rail-section, .gh-discovery-sidebar-section")
        .filter({ hasText: /Asset Type/i })
        .first();
      if (!(await section.count())) return false;
      const checkbox = section.locator("input.gh-checkbox");
      const count = section.locator(".gh-checkbox-count");
      return (await checkbox.count()) > 0 && (await count.count()) > 0;
    },
  },
  {
    id: "sidebar.asset-type-singular",
    name: "Sidebar: section title is singular 'Asset Type' (not 'Asset Types')",
    check: async (page) => {
      const singular = page.locator(".gh-panel-title").filter({ hasText: /^Asset Type$/ });
      return (await singular.count()) > 0;
    },
  },
  {
    id: "sidebar.domain-checkboxes",
    name: "Sidebar: Domain rows rendered as checkboxes",
    check: async (page) => {
      const section = page
        .locator(".gh-discovery-sidebar-section")
        .filter({ hasText: /^Domain/ })
        .first();
      if (!(await section.count())) return false;
      return (await section.locator("input.gh-checkbox").count()) > 0;
    },
  },
  {
    id: "sidebar.owner-user-team-checkbox",
    name: "Sidebar: Owner section is a single User/Team checkbox",
    check: async (page) => {
      const section = page
        .locator(".gh-discovery-sidebar-section")
        .filter({ hasText: /Owner/ })
        .first();
      if (!(await section.count())) return false;
      const label = await section.innerText();
      return /User\/Team/.test(label);
    },
  },
  {
    id: "sidebar.workflow-checkboxes",
    name: "Sidebar: Workflow State rendered as checkboxes with Published/In Review/Obsolete",
    check: async (page) => {
      const section = page
        .locator(".gh-discovery-sidebar-section")
        .filter({ hasText: /Workflow State/ })
        .first();
      if (!(await section.count())) return false;
      const text = await section.innerText();
      return /Published/.test(text) && /In Review/.test(text) && /Obsolete/.test(text);
    },
  },
  {
    id: "sidebar.no-saved-views",
    name: "Sidebar: Saved Views section removed",
    check: async (page) =>
      (await page
        .locator(".gh-discovery-sidebar-section .gh-panel-title")
        .filter({ hasText: /^Saved Views$/ })
        .count()) === 0,
  },
  {
    id: "sidebar.single-catalog-tree",
    name: "Sidebar: only one catalog tree (no duplicate Service Tree)",
    check: async (page) =>
      (await page.locator(".gh-catalog-tree").count()) === 1,
  },
  {
    id: "sidebar.glossary-term-input",
    name: "Sidebar: Glossary Term free-text input",
    selector: 'input.gh-sidebar-input[aria-label*="glossary" i]',
  },
  {
    id: "sidebar.sensitivity-chips",
    name: "Sidebar: Sensitivity chips (PII / Conf / Internal)",
    check: async (page) => {
      const section = page
        .locator(".gh-discovery-sidebar-section")
        .filter({ hasText: /Sensitivity/ })
        .first();
      if (!(await section.count())) return false;
      const text = await section.innerText();
      return /PII/.test(text) && /Conf/.test(text) && /Internal/.test(text);
    },
  },

  // ─────── PREVIEW PANEL (items 39–47) ───────
  {
    id: "preview.asset-preview-eyebrow",
    name: "Preview: 'Asset preview' eyebrow",
    check: async (page) => {
      const eyebrow = page.locator(".gh-selection-preview .gh-eyebrow").first();
      if (!(await eyebrow.count())) return false;
      const text = await eyebrow.innerText();
      return /Asset preview/i.test(text);
    },
  },
  {
    id: "preview.close-button",
    name: "Preview: X close button present",
    selector: '.gh-asset-preview-header-close',
  },
  {
    id: "preview.action-grid-4-buttons",
    name: "Preview: 2×2 action grid with 4 buttons",
    check: async (page) => {
      const grid = page.locator(".gh-asset-preview-action-grid");
      if (!(await grid.count())) return false;
      const buttons = await grid.locator("button").count();
      return buttons === 4;
    },
  },
  {
    id: "preview.metadata-pills",
    name: "Preview: domain + glossary rendered as pills",
    check: async (page) => {
      const domainPill = page.locator(
        ".gh-asset-preview-metadata .gh-labeled-pill-domain",
      );
      const glossaryPill = page.locator(
        ".gh-asset-preview-metadata .gh-labeled-pill-glossary",
      );
      return (await domainPill.count()) > 0 && (await glossaryPill.count()) > 0;
    },
  },
  {
    id: "preview.schema-scope-chips",
    name: "Preview: schema overview = catalog/schema scope chips",
    check: async (page) => {
      const chips = page.locator(".gh-asset-preview-schema-chips .gh-chip");
      if ((await chips.count()) < 2) return false;
      const texts = await chips.allInnerTexts();
      // One chip should be catalog-like, the other schema_(N)
      return texts.some((t) => /_\(\d+\)/.test(t));
    },
  },
  {
    id: "preview.lineage-icon-nodes",
    name: "Preview: simplified lineage preview uses icon nodes",
    check: async (page) => {
      const nodes = page.locator(".gh-lineage-mini-node svg");
      return (await nodes.count()) >= 2;
    },
  },
  {
    id: "preview.usage-2cell-with-caption",
    name: "Preview: usage metrics = 2-cell grid with stat + secondary caption",
    check: async (page) => {
      const cells = page.locator(".gh-asset-preview-usage-cell");
      if ((await cells.count()) !== 2) return false;
      const subs = await cells.locator(".gh-asset-preview-usage-subcell").count();
      return subs === 2;
    },
  },
  {
    id: "preview.associated-tasks-nested",
    name: "Preview: associated tasks renders ⓘ info + nested child row",
    check: async (page) => {
      const tree = page.locator(".gh-asset-preview-task-tree");
      if (!(await tree.count())) return false;
      const parent = tree.locator(".gh-asset-preview-task-row.is-parent");
      const child = tree.locator(".gh-asset-preview-task-child");
      const info = page.locator(".gh-info-glyph");
      return (
        (await parent.count()) > 0 &&
        (await child.count()) > 0 &&
        (await info.count()) > 0
      );
    },
  },

  // ─────── GLOBAL FRAMING (items 48–49) ───────
  {
    id: "framing.flat-background",
    name: "Framing: page background flattened (no gradient)",
    check: async (page) => {
      const body = page.locator("body");
      const bg = await body.evaluate((el) => getComputedStyle(el).backgroundImage);
      return !/(linear|radial)-gradient/.test(bg);
    },
  },
  {
    id: "framing.thin-panel-borders",
    name: "Framing: panel borders use thin charcoal stroke",
    check: async (page) => {
      const panel = page.locator(".gh-panel").first();
      if (!(await panel.count())) return false;
      const color = await panel.evaluate((el) => getComputedStyle(el).borderTopColor);
      // Any near-black with alpha (rgba(15, 23, 42, X)) is acceptable
      return /rgba\(1[0-9],\s*\d+,\s*\d+,\s*0?\.\d+\)|rgb\(\d+,\s*\d+,\s*\d+\)/.test(color);
    },
  },
  {
    id: "framing.no-soft-shadow",
    name: "Framing: panel drop shadow is none/flat",
    check: async (page) => {
      const panel = page.locator(".gh-panel").first();
      if (!(await panel.count())) return false;
      const shadow = await panel.evaluate((el) => getComputedStyle(el).boxShadow);
      return shadow === "none";
    },
  },

  // ─────── DOM ALIAS TABS (tests coverage) ───────
  {
    id: "topbar.secondary-nav-clipped",
    name: "Hidden top-nav alias tabs stay clipped (a11y-only)",
    check: async (page) => {
      const nav = page.locator(".gh-shell-nav.gh-shell-nav-secondary");
      if (!(await nav.count())) return false;
      return await nav.evaluate((el) => {
        const cs = getComputedStyle(el);
        return (
          cs.position === "absolute" &&
          cs.clip === "rect(0px, 0px, 0px, 0px)" &&
          cs.overflow === "hidden"
        );
      });
    },
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
      results.push({ id: trait.id, name: trait.name, ok, severity: trait.severity || "critical" });
    } catch (err) {
      results.push({
        id: trait.id,
        name: trait.name,
        ok: false,
        severity: trait.severity || "critical",
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
    // Give the live catalog a chance to hydrate so card/preview traits light up.
    await page.waitForTimeout(12000);

    const results = await runTraits(page);
    const pass = results.filter((r) => r.ok).length;
    const fail = results.length - pass;
    const criticalFail = results.filter((r) => !r.ok && r.severity === "critical").length;

    await page.screenshot({
      fullPage: false,
      path: path.join(OUT_DIR, "identity-snapshot.png"),
      scale: "css",
      type: "png",
    });
    await page.screenshot({
      fullPage: true,
      path: path.join(OUT_DIR, "identity-snapshot-full.png"),
      scale: "css",
      type: "png",
    });

    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      total: results.length,
      pass,
      fail,
      criticalFail,
      results,
    };
    await fs.writeFile(
      path.join(OUT_DIR, "report.json"),
      JSON.stringify(report, null, 2),
    );

    console.log(`\nStructural identity: ${pass}/${results.length} traits matched`);
    console.log(`Critical failures: ${criticalFail}\n`);
    for (const r of results) {
      const glyph = r.ok ? "✓" : r.severity === "critical" ? "✗" : "○";
      console.log(
        `${glyph}  ${r.id.padEnd(42)} ${r.name}${r.error ? ` — ${r.error}` : ""}`,
      );
    }
    console.log(`\nReport: ${path.join(OUT_DIR, "report.json")}`);
    console.log(`Screenshot: ${path.join(OUT_DIR, "identity-snapshot.png")}`);

    process.exit(criticalFail === 0 ? 0 : 1);
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
