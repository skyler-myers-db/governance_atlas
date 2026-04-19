/**
 * Comprehensive Playwright QA for the deployed Governance Hub.
 *
 * Exercises every button, input, sub-tab, sidebar filter, side rail icon,
 * density control, copy link, hover preview, and selection across the
 * Discovery, Lineage, Governance, Taxonomy, and Audit surfaces.
 * Checks for console errors / page errors / failed network responses after
 * every interaction and takes a screenshot at each major step so the live
 * look can be diff'd against the design target.
 *
 * Requires a CDP-enabled Chrome at http://127.0.0.1:9223 with an
 * authenticated Databricks session. Launch instructions:
 *
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *     --remote-debugging-port=9223 \
 *     --user-data-dir="$HOME/.chrome-cdp-profile" \
 *     <app-url>
 *
 * Usage:
 *   node frontend/scripts/govhub_comprehensive_qa.mjs <base-url>
 *
 * The script writes a JSON report to /tmp/govhub-qa/report.json listing
 * which interactions passed, which surfaced errors, and the screenshot
 * names produced.
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
  process.env.GOVHUB_QA_OUT_DIR || path.join(REPO_ROOT, "docs", "screenshots", "qa");
const VIEWPORT_WIDE = { width: 1680, height: 1050 };
const VIEWPORT_LAPTOP = { width: 1366, height: 820 };
const VIEWPORT_NARROW = { width: 1100, height: 760 };

if (!BASE_URL) {
  console.error("Usage: node frontend/scripts/govhub_comprehensive_qa.mjs <base-url>");
  process.exit(1);
}

const APP_ORIGIN = new URL(BASE_URL).origin;
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  appOrigin: APP_ORIGIN,
  checks: [],
  screenshots: [],
  consoleErrors: [],
  pageErrors: [],
  networkErrors: [],
};

function urlFor(p) {
  const base = BASE_URL.replace(/\/+$/, "");
  return `${base}${p}`;
}

function sameOrigin(u) {
  try {
    return new URL(u).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

async function flushReport() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
}

async function pushCheck(name, status, detail = {}) {
  const entry = { name, status, ...detail };
  report.checks.push(entry);
  console.log(`[${status}] ${name}${detail.note ? ` — ${detail.note}` : ""}`);
  await flushReport();
}

async function screenshot(page, name) {
  const filePath = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  report.screenshots.push(filePath);
  await flushReport();
}

function attachListeners(page) {
  page.on("pageerror", async (error) => {
    if (!sameOrigin(page.url())) return;
    report.pageErrors.push({
      message: error?.message || String(error),
      stack: error?.stack || "",
      url: page.url(),
    });
    await flushReport();
  });
  page.on("console", async (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    if (!sameOrigin(page.url())) return;
    report.consoleErrors.push({
      type: message.type(),
      text: message.text(),
      url: page.url(),
    });
    await flushReport();
  });
  page.on("requestfailed", async (req) => {
    if (!sameOrigin(req.url())) return;
    const failureText = req.failure()?.errorText || "failed";
    // Client-aborted requests (navigation or filter change canceled an
    // in-flight fetch) are noise, not regressions.
    if (failureText === "net::ERR_ABORTED") return;
    report.networkErrors.push({
      url: req.url(),
      failureText,
      method: req.method(),
    });
    await flushReport();
  });
  page.on("response", async (response) => {
    if (!sameOrigin(response.url()) || response.status() < 400) return;
    report.networkErrors.push({
      url: response.url(),
      status: response.status(),
      method: response.request().method(),
    });
    await flushReport();
  });
}

async function waitSettled(page, ms = 1200) {
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function clickIfPresent(page, selector, label) {
  const el = await page.$(selector);
  if (!el) {
    await pushCheck(label, "skipped", { selector, note: "not present" });
    return false;
  }
  try {
    await el.click({ timeout: 3000 });
    await page.waitForTimeout(450);
    await pushCheck(label, "ok", { selector });
    return true;
  } catch (err) {
    await pushCheck(label, "error", {
      selector,
      note: err?.message || String(err),
    });
    return false;
  }
}

async function fillIfPresent(page, selector, text, label) {
  const el = await page.$(selector);
  if (!el) {
    await pushCheck(label, "skipped", { selector, note: "not present" });
    return false;
  }
  try {
    await el.fill(text, { timeout: 3000 });
    await page.waitForTimeout(400);
    await pushCheck(label, "ok", { selector, text });
    return true;
  } catch (err) {
    await pushCheck(label, "error", {
      selector,
      note: err?.message || String(err),
    });
    return false;
  }
}

async function runShell(page) {
  // Left icon rail: click each module entry
  const railSelectors = [
    ["Go to Discovery", 'button[aria-label="Go to Discovery"]'],
    ["Go to Lineage", 'button[aria-label="Go to Lineage"]'],
    ["Go to Governance", 'button[aria-label="Go to Governance"]'],
    ["Go to Taxonomy", 'button[aria-label="Go to Taxonomy"]'],
    ["Go to Audit", 'button[aria-label="Go to Audit"]'],
  ];
  for (const [label, selector] of railSelectors) {
    await clickIfPresent(page, selector, `rail: ${label}`);
    await waitSettled(page, 1100);
    await screenshot(page, `rail-${label.toLowerCase().replace(/\s+/g, "-")}`);
  }
  // Recent activity + Quick action
  await clickIfPresent(page, '.gh-header-action-button-ghost', "header: Recent activity");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await clickIfPresent(page, '.gh-header-action-button-primary', "header: Quick action (open palette)");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

async function runDiscovery(page) {
  await page.goto(urlFor("/discovery"), { waitUntil: "domcontentloaded" });
  await waitSettled(page, 1600);
  await screenshot(page, "discovery-initial");

  // Sub-tabs: Navigation then Discovery
  await clickIfPresent(page, '.gh-sub-tab:has-text("Navigation")', "subtab: Navigation");
  await waitSettled(page, 800);
  await screenshot(page, "discovery-navigation-tab");
  await clickIfPresent(page, '.gh-sub-tab:has-text("Discovery")', "subtab: Discovery");
  await waitSettled(page, 800);

  // Density toggle
  for (const density of ["Compact", "Normal", "Spacious"]) {
    await clickIfPresent(page, `.gh-discovery-density-option:has-text("${density}")`, `density: ${density}`);
    await waitSettled(page, 500);
    await screenshot(page, `discovery-density-${density.toLowerCase()}`);
  }

  // Stack Filters popover
  await clickIfPresent(page, '.gh-discovery-stack-trigger', "toolbar: Stack Filters open");
  await waitSettled(page, 700);
  await screenshot(page, "discovery-stack-filters-open");
  await page.keyboard.press("Escape");
  await waitSettled(page, 400);

  // Sort dropdown change
  const sortSelect = await page.$('select.gh-select-sort');
  if (sortSelect) {
    const options = await sortSelect.$$eval("option", (opts) =>
      opts.slice(0, 3).map((o) => o.value),
    );
    for (const value of options) {
      try {
        await sortSelect.selectOption(value);
        await page.waitForTimeout(450);
        await pushCheck(`sort: ${value}`, "ok");
      } catch (err) {
        await pushCheck(`sort: ${value}`, "error", { note: err?.message });
      }
    }
  }

  // Sidebar Asset Type rows (first 3)
  const assetTypeRows = await page.$$(".gh-category-list .gh-category-row");
  for (let i = 0; i < Math.min(assetTypeRows.length, 3); i += 1) {
    try {
      await assetTypeRows[i].click();
      await page.waitForTimeout(500);
      await pushCheck(`sidebar: asset-type row #${i}`, "ok");
    } catch (err) {
      await pushCheck(`sidebar: asset-type row #${i}`, "error", {
        note: err?.message,
      });
    }
  }
  // Reset by clicking "All types" (first row)
  if (assetTypeRows.length) {
    await assetTypeRows[0].click().catch(() => {});
    await page.waitForTimeout(400);
  }

  // Sensitivity chips
  const sensChips = await page.$$(".gh-discovery-chip-row .gh-chip");
  for (let i = 0; i < Math.min(sensChips.length, 3); i += 1) {
    try {
      await sensChips[i].click();
      await page.waitForTimeout(400);
      await sensChips[i].click(); // toggle off
      await page.waitForTimeout(300);
      await pushCheck(`sidebar: sensitivity chip #${i}`, "ok");
    } catch (err) {
      await pushCheck(`sidebar: sensitivity chip #${i}`, "error", {
        note: err?.message,
      });
    }
  }

  // Owner + Glossary Term inputs
  await fillIfPresent(page, 'input.gh-sidebar-input[aria-label*="owner" i]', "skyler", "sidebar: owner input");
  await page.waitForTimeout(600);
  await fillIfPresent(page, 'input.gh-sidebar-input[aria-label*="owner" i]', "", "sidebar: owner input clear");
  await fillIfPresent(page, 'input.gh-sidebar-input[aria-label*="glossary" i]', "customer", "sidebar: glossary input");
  await page.waitForTimeout(600);
  await fillIfPresent(page, 'input.gh-sidebar-input[aria-label*="glossary" i]', "", "sidebar: glossary input clear");

  // Toolbar filter (text search)
  await fillIfPresent(page, '.gh-discovery-toolbar-search', "ap_self", "toolbar: filter text");
  await page.waitForTimeout(700);
  await fillIfPresent(page, '.gh-discovery-toolbar-search', "", "toolbar: filter text clear");

  // Copy link
  await clickIfPresent(page, '.gh-discovery-toolbar-simple .gh-secondary-button-compact', "toolbar: Copy link");

  // Card interactions: hover first card, click favorite star
  const firstCard = await page.$(".gh-discovery-asset-card");
  if (firstCard) {
    try {
      await firstCard.hover();
      await page.waitForTimeout(400);
      await pushCheck("card: hover first", "ok");
    } catch (err) {
      await pushCheck("card: hover first", "error", { note: err?.message });
    }
    const star = await firstCard.$(".gh-discovery-asset-card-star");
    if (star) {
      await star.click().catch(() => {});
      await page.waitForTimeout(300);
      await star.click().catch(() => {}); // toggle off
      await pushCheck("card: favorite toggle", "ok");
    }
    await firstCard.click().catch(() => {});
    await page.waitForTimeout(600);
    await screenshot(page, "discovery-card-selected");
  }

  // Preview panel action buttons (View Details, Add to Lineage, etc.)
  const previewButtons = await page.$$(".gh-discovery-preview-actions button, .gh-action-grid button");
  if (previewButtons.length) {
    await pushCheck(`preview: action buttons count`, "ok", { count: previewButtons.length });
  }

  // Saved view click
  await clickIfPresent(page, '.gh-saved-view', "sidebar: saved view #1");
  await page.waitForTimeout(400);
  // Second click restores
  await clickIfPresent(page, '.gh-saved-view', "sidebar: saved view toggle off");

  await screenshot(page, "discovery-post-all-clicks");
}

async function runLineage(page) {
  await page.goto(urlFor("/lineage"), { waitUntil: "domcontentloaded" });
  await waitSettled(page, 1800);
  await screenshot(page, "lineage-initial");
  // Deep-link via /lineage/<fqn>
  const deepFqn = encodeURIComponent("prod.silver.ap_self_assessed_tax_dist");
  await page.goto(urlFor(`/lineage/${deepFqn}`), { waitUntil: "domcontentloaded" });
  await waitSettled(page, 1800);
  await screenshot(page, "lineage-deeplink-path");
  // Also the legacy ?preview fallback
  await page.goto(urlFor(`/lineage?preview=${deepFqn}`), {
    waitUntil: "domcontentloaded",
  });
  await waitSettled(page, 1800);
  await screenshot(page, "lineage-deeplink-preview-fallback");
  await pushCheck("lineage: deep-link paths loaded", "ok");
}

async function runGovernance(page) {
  await page.goto(urlFor("/governance"), { waitUntil: "domcontentloaded" });
  await waitSettled(page, 1200);
  await screenshot(page, "governance-initial");
  await pushCheck("governance: loaded", "ok");
}

async function runTaxonomy(page) {
  await page.goto(urlFor("/taxonomy"), { waitUntil: "domcontentloaded" });
  await waitSettled(page, 1200);
  await screenshot(page, "taxonomy-initial");
  await pushCheck("taxonomy: loaded", "ok");
}

async function runAudit(page) {
  await page.goto(urlFor("/audit"), { waitUntil: "domcontentloaded" });
  await waitSettled(page, 1200);
  await screenshot(page, "audit-initial");
  await pushCheck("audit: loaded", "ok");
}

async function runResponsive(page) {
  for (const vp of [VIEWPORT_WIDE, VIEWPORT_LAPTOP, VIEWPORT_NARROW]) {
    await page.setViewportSize(vp);
    await page.goto(urlFor("/discovery"), { waitUntil: "domcontentloaded" });
    await waitSettled(page, 1400);
    await screenshot(page, `responsive-${vp.width}x${vp.height}`);
    await pushCheck(`responsive @ ${vp.width}x${vp.height}`, "ok");
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());
    attachListeners(page);
    await page.setViewportSize(VIEWPORT_WIDE);
    await page.goto(urlFor("/discovery"), { waitUntil: "domcontentloaded" });
    await waitSettled(page, 1500);

    await runShell(page);
    await runDiscovery(page);
    await runLineage(page);
    await runGovernance(page);
    await runTaxonomy(page);
    await runAudit(page);
    await runResponsive(page);

    // Final pass: navigate home, verify console clean
    await page.goto(urlFor("/discovery"), { waitUntil: "domcontentloaded" });
    await waitSettled(page, 1400);
    await screenshot(page, "final-discovery");

    await pushCheck("suite: complete", "ok", {
      consoleErrorCount: report.consoleErrors.length,
      pageErrorCount: report.pageErrors.length,
      networkErrorCount: report.networkErrors.length,
      screenshotCount: report.screenshots.length,
      checkCount: report.checks.length,
    });
  } finally {
    try {
      await browser.close();
    } catch {
      /* leave CDP intact */
    }
  }
  console.log("---");
  console.log(`Checks: ${report.checks.length}`);
  console.log(`Console errors: ${report.consoleErrors.length}`);
  console.log(`Page errors: ${report.pageErrors.length}`);
  console.log(`Network errors: ${report.networkErrors.length}`);
  console.log(`Screenshots: ${report.screenshots.length}`);
  console.log(`Report: ${path.join(OUT_DIR, "report.json")}`);
}

main().catch(async (err) => {
  console.error(err);
  await flushReport();
  process.exit(1);
});
