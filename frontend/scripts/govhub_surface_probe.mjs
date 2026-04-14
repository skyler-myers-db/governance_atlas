import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const [, , targetUrl, screenshotPathArg = "", waitMsArg = "", selectorArg = ""] = process.argv;

if (!targetUrl) {
  console.error(
    "Usage: node frontend/scripts/govhub_surface_probe.mjs <url> [screenshot-path] [wait-ms] [selector]",
  );
  process.exit(1);
}

const screenshotPath = screenshotPathArg || "";
const waitMs = Number.parseInt(waitMsArg, 10) || 4000;
const selector = selectorArg || "";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
let page = null;

try {
  const contexts = browser.contexts();
  const context = contexts[0] || (await browser.newContext());
  page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1040 });
  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  if (selector) {
    try {
      await page.waitForSelector(selector, { timeout: Math.max(waitMs, 6000) });
    } catch {}
  }
  await page.waitForTimeout(waitMs);
  try {
    await page.waitForLoadState("networkidle", { timeout: 6_000 });
  } catch {}

  if (screenshotPath) {
    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });
  }

  const report = await page.evaluate(() => ({
    title: document.title,
    url: window.location.href,
    readyState: document.readyState,
    metrics: {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      nodeCount: document.querySelectorAll(".react-flow__node").length,
      edgeCount: document.querySelectorAll(".react-flow__edge").length,
      lineageLoading: document.body.innerText.includes("Loading lineage graph"),
    },
    selectors: {
      entityTabs: Boolean(document.querySelector(".gh-entity-record-tabs")),
      discoveryGrid: Boolean(document.querySelector(".gh-discovery-main-grid")),
      lineageCanvas: Boolean(document.querySelector(".gh-lineage-canvas")),
      emptyState: Boolean(document.querySelector(".gh-empty-state")),
      runtimeError: document.body.innerText.includes("runtime is unavailable"),
    },
    bodyPreview: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 1200),
  }));

  console.log(JSON.stringify(report, null, 2));
} finally {
  try {
    await page?.close();
  } catch {}
  await browser.close();
}
