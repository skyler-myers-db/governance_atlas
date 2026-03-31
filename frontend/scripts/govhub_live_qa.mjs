import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";

const BASE_URL = "https://governance-hub-7405619023278880.0.azure.databricksapps.com";
const ASSET_FQN = "test.silver.ap_self_assessed_tax_dist";
const COLUMN_NAME = "INVOICE_DISTRIBUTION_ID";
const WRITABLE_ASSET_FQN = "dev.wacs_silver_test.slv_work_req_latest_status";
const WRITABLE_COLUMN_NAME = "work_req_id";
const OUT_DIR = "/tmp/govhub-live-qa";
const suffix = `${Date.now()}`.slice(-8);
const requestTitle = `Codex QA request ${suffix}`;
const requestNote = `Codex QA request note ${suffix}`;
const glossaryName = `Codex QA Term ${suffix}`;
const glossaryDefinition = `Codex QA definition ${suffix}`;
const glossaryDefinitionUpdated = `Codex QA definition updated ${suffix}`;
const glossaryOwner = "skyler.myers@tristategt.org";
const glossaryReviewerInitial = "skyler.myers@tristategt.org:reviewer";
const glossaryReviewerUpdated = "skyler.myers@tristategt.org:approver";

const report = {
  generatedAt: new Date().toISOString(),
  assetFqn: ASSET_FQN,
  columnName: COLUMN_NAME,
  writableAssetFqn: WRITABLE_ASSET_FQN,
  writableColumnName: WRITABLE_COLUMN_NAME,
  requestTitle,
  glossaryName,
  screenshots: [],
  checks: [],
};

function pushCheck(name, status, detail = {}) {
  report.checks.push({ name, status, ...detail });
}

async function connect() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const context = browser.contexts()[0];
  const existingPages = context.pages();
  const page =
    existingPages.find((candidate) => candidate.url().startsWith(BASE_URL)) ||
    existingPages.find((candidate) => /^https?:/i.test(candidate.url())) ||
    existingPages[0] ||
    (await context.newPage());
  await page.bringToFront();
  await page.setViewportSize({ width: 1600, height: 1040 });
  return { browser, page };
}

async function gotoSurface(page, url, selector, waitMs = 1200) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(selector, { timeout: 45000 });
  await page.waitForTimeout(waitMs);
}

async function resetDiscoverySession(page) {
  await page.goto(`${BASE_URL}/?module=discovery&surface=discovery&_cb=codex-qa-reset-${suffix}`, {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate(() => {
    try {
      window.sessionStorage.clear();
    } catch {
      // Best-effort only.
    }
  });
}

async function screenshot(page, name, fullPage = false) {
  const filePath = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage });
  report.screenshots.push(filePath);
}

async function waitForOverviewWarmup(page, timeoutMs = 8000) {
  try {
    await page.waitForFunction(
      () => {
        const cards = [...document.querySelectorAll(".gh-record-card")];
        const liveSignalCard = cards.find((card) => card.innerText.includes("Live Record Signals"));
        const lineageCard = cards.find((card) => card.innerText.includes("Lineage Context"));
        if (!liveSignalCard || !lineageCard) return false;
        const liveText = liveSignalCard.innerText;
        const lineageText = lineageCard.innerText;
        return (
          !liveText.includes("Loading…") &&
          !liveText.includes("Loading connected lineage") &&
          !lineageText.includes("Loading connected lineage")
        );
      },
      { timeout: timeoutMs },
    );
  } catch {
    // Keep the current state in the report when the warm-up does not settle in time.
  }
}

async function fetchJson(page, url, init = {}) {
  return page.evaluate(
    async ({ url: targetUrl, init: targetInit }) => {
      const response = await fetch(targetUrl, targetInit);
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return {
        ok: response.ok,
        status: response.status,
        text,
        json,
      };
    },
    { url, init },
  );
}

function rowMap(rows = []) {
  return Object.fromEntries(
    rows
      .map((row) => {
        const [label, ...rest] = String(row || "")
          .split("\n")
          .map((part) => part.trim())
          .filter(Boolean);
        return label ? [label, rest.join(" ")] : null;
      })
      .filter(Boolean),
  );
}

await fs.mkdir(OUT_DIR, { recursive: true });

const { browser, page } = await connect();

let originalWritableColumnDraft = { description: "", tags: "" };
let createdRequestId = "";
let createdGlossaryTermId = "";

try {
  await resetDiscoverySession(page);
  await gotoSurface(
    page,
    `${BASE_URL}/?module=discovery&surface=discovery&_cb=codex-qa-${suffix}`,
    ".gh-discovery-main-grid",
  );
  await screenshot(page, "discovery-home");

  const discoverySummary = await page.evaluate(() => {
    const categoryRows = [...document.querySelectorAll(".gh-category-row")].map((row) => {
      const [label, count] = row.innerText
        .split("\n")
        .map((part) => part.trim())
        .filter(Boolean);
      return [label, Number(String(count || "").replace(/[^\d]/g, ""))];
    });
    const selectedButtons = [...document.querySelectorAll(".gh-selection-preview-actions button")].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        text: button.textContent.trim(),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    });
    const moduleLabel = document.querySelector(".gh-shell-module-label");
    const userEmail = document.querySelector(".gh-shell-user");
    const brand = document.querySelector(".gh-shell-brand-mark");
    const catalogChip = document.querySelector(".gh-discovery-sidebar .gh-chip-stack button");
    const connectedAssets = [...document.querySelectorAll(".gh-selection-preview .gh-lineage-linked-row")].map((row) =>
      row.innerText.trim(),
    );
    return {
      counts: Object.fromEntries(categoryRows),
      selectedButtons,
      sameButtonRow: new Set(selectedButtons.map((button) => Math.round(button.y))).size === 1,
      moduleLabelFont: moduleLabel ? parseFloat(getComputedStyle(moduleLabel).fontSize) : 0,
      userFont: userEmail ? parseFloat(getComputedStyle(userEmail).fontSize) : 0,
      brandSize: brand
        ? {
            width: brand.getBoundingClientRect().width,
            height: brand.getBoundingClientRect().height,
          }
        : null,
      catalogCursor: catalogChip ? getComputedStyle(catalogChip).cursor : "",
      connectedAssets,
    };
  });
  pushCheck("discovery-shell", "ok", discoverySummary);

  await page.locator("#gh-global-search-input").fill("ta");
  await page.waitForSelector(".gh-search-dropdown", { timeout: 15000 });
  await screenshot(page, "discovery-search-open");
  const searchOverlay = await page.evaluate(() => {
    const dropdown = document.querySelector(".gh-search-dropdown");
    const row = document.querySelector(".gh-search-result-row");
    const catalogPanel = document.querySelector(".gh-discovery-command-panel");
    if (!dropdown || !row || !catalogPanel) return null;
    const rowRect = row.getBoundingClientRect();
    const probeX = rowRect.left + Math.min(40, rowRect.width / 4);
    const probeY = rowRect.top + Math.min(22, rowRect.height / 2);
    const topElement = document.elementFromPoint(probeX, probeY);
    return {
      dropdownOnTop: Boolean(topElement?.closest(".gh-search-dropdown")),
      dropdownTop: dropdown.getBoundingClientRect().top,
      dropdownBottom: dropdown.getBoundingClientRect().bottom,
      catalogTop: catalogPanel.getBoundingClientRect().top,
      resultLabels: [...document.querySelectorAll(".gh-search-result-title")].slice(0, 4).map((node) => node.textContent.trim()),
    };
  });
  pushCheck("global-search-overlay", searchOverlay?.dropdownOnTop ? "ok" : "warn", searchOverlay || {});
  await page.keyboard.press("Escape");

  await gotoSurface(
    page,
    `${BASE_URL}/?module=discovery&surface=entity&asset=${ASSET_FQN}&_cb=codex-qa-entity-${suffix}`,
    ".gh-entity-record-tabs",
  );
  await waitForOverviewWarmup(page);
  await screenshot(page, "entity-overview");

  const overviewRaw = await page.evaluate(() => {
    const liveSignalCard = [...document.querySelectorAll(".gh-record-card")].find((card) =>
      card.innerText.includes("Live Record Signals"),
    );
    const lineageCard = [...document.querySelectorAll(".gh-record-card")].find((card) =>
      card.innerText.includes("Lineage Context"),
    );
    const signalRows = liveSignalCard
      ? [...liveSignalCard.querySelectorAll(".gh-attribute-row")].map((row) => row.innerText.trim())
      : [];
    const metricRows = [...document.querySelectorAll(".gh-preview-stat-card.gh-entity-metric-card")].map((row) =>
      row.innerText.trim(),
    );
    return {
      signalRows,
      metricRows,
      lineageSummary: lineageCard ? lineageCard.innerText.trim() : "",
    };
  });
  const overview = {
    ...overviewRaw,
    signals: rowMap(overviewRaw.signalRows),
  };
  pushCheck("entity-overview", "ok", overview);

  await page.getByRole("button", { name: "Usage & Workloads" }).click();
  await page.waitForTimeout(1800);
  await screenshot(page, "entity-usage-workloads");
  const usageState = await page.evaluate(() => {
    const titles = [...document.querySelectorAll(".gh-task-title")].map((node) => node.textContent.trim());
    const relatedButtons = [...document.querySelectorAll(".gh-task-row .gh-chip-row button")].map((button) =>
      button.textContent.trim(),
    );
    return {
      titles,
      relatedButtons,
      rawUuidOnlyTitles: titles.filter((title) =>
        /^[0-9a-f]{8,}(-[0-9a-f]{4,}){0,}$/i.test(title),
      ),
    };
  });
  pushCheck(
    "usage-workloads",
    usageState.relatedButtons.length ? "ok" : "warn",
    usageState,
  );

  const usageLinkedAsset = page.locator(".gh-task-row .gh-chip-row button").first();
  if (await usageLinkedAsset.count()) {
    const linkedLabel = await usageLinkedAsset.textContent();
    await usageLinkedAsset.click();
    await page.waitForSelector(".gh-entity-record-tabs", { timeout: 15000 });
    pushCheck("usage-linked-asset-navigation", "ok", {
      linkedLabel: (linkedLabel || "").trim(),
      navigatedUrl: page.url(),
    });
  } else {
    pushCheck("usage-linked-asset-navigation", "warn", {
      reason: "No linked asset buttons were rendered in Usage & Workloads.",
    });
  }

  await gotoSurface(
    page,
    `${BASE_URL}/?module=discovery&surface=entity&asset=${ASSET_FQN}&_cb=codex-qa-entity-schema-${suffix}`,
    ".gh-entity-record-tabs",
  );
  await page.getByRole("button", { name: "Schema" }).click();
  await page.waitForSelector(".gh-table tbody tr", { timeout: 15000 });
  await page.locator(".gh-table tbody tr", { hasText: COLUMN_NAME }).click();
  const selectedColumnCard = page.locator(".gh-record-card").filter({ hasText: "Selected Column" }).first();
  await selectedColumnCard.waitFor({ timeout: 15000 });
  const readOnlySchemaState = await page.evaluate(() => {
    const selected = [...document.querySelectorAll(".gh-record-card")].find((card) =>
      card.innerText.includes("Selected Column"),
    );
    if (!selected) return null;
    return {
      hasTextarea: Boolean(selected.querySelector("textarea")),
      hasTagsInput: Boolean(selected.querySelector('input[placeholder="domain=Finance, sensitivity=PII"]')),
      hasSaveButton: [...selected.querySelectorAll("button")].some(
        (button) => button.textContent.trim() === "Save column",
      ),
      text: selected.innerText.trim(),
    };
  });
  pushCheck(
    "schema-column-readonly",
    readOnlySchemaState && !readOnlySchemaState.hasTextarea && !readOnlySchemaState.hasSaveButton ? "ok" : "warn",
    readOnlySchemaState || {},
  );

  await gotoSurface(
    page,
    `${BASE_URL}/?module=discovery&surface=entity&asset=${WRITABLE_ASSET_FQN}&_cb=codex-qa-entity-schema-write-${suffix}`,
    ".gh-entity-record-tabs",
  );
  await page.getByRole("button", { name: "Schema" }).click();
  await page.waitForSelector(".gh-table tbody tr", { timeout: 15000 });
  await page.locator(".gh-table tbody tr", { hasText: WRITABLE_COLUMN_NAME }).click();
  const writableColumnCard = page.locator(".gh-record-card").filter({ hasText: "Selected Column" }).first();
  await writableColumnCard.waitFor({ timeout: 15000 });
  const descriptionField = writableColumnCard.locator("textarea").first();
  const tagsField = writableColumnCard.locator('input[placeholder="domain=Finance, sensitivity=PII"]').first();
  originalWritableColumnDraft = {
    description: await descriptionField.inputValue(),
    tags: await tagsField.inputValue(),
  };
  const updatedColumnDraft = {
    description: `Codex QA column description ${suffix}`,
    tags: originalWritableColumnDraft.tags
      ? `${originalWritableColumnDraft.tags}, qa_probe=${suffix}`
      : `qa_probe=${suffix}`,
  };
  await descriptionField.fill(updatedColumnDraft.description);
  await tagsField.fill(updatedColumnDraft.tags);
  await writableColumnCard.getByRole("button", { name: "Save column" }).click();
  await page.waitForTimeout(1800);
  const columnAfterUpdate = await fetchJson(
    page,
    `/api/assets/${WRITABLE_ASSET_FQN}?sections=schema&_qa=${Date.now()}`,
  );
  const updatedColumn =
    (columnAfterUpdate.json?.columns || []).find((column) => column.name === WRITABLE_COLUMN_NAME) || null;
  const columnUpdateOk =
    columnAfterUpdate.ok &&
    updatedColumn &&
    String(updatedColumn.description || "").includes(updatedColumnDraft.description) &&
    (updatedColumn.tagLabels || []).some((tag) => String(tag).includes(`qa_probe=${suffix}`));
  pushCheck("schema-column-update", columnUpdateOk ? "ok" : "warn", {
    originalWritableColumnDraft,
    updatedColumnDraft,
    apiColumn: updatedColumn,
  });

  await descriptionField.fill(originalWritableColumnDraft.description);
  await tagsField.fill(originalWritableColumnDraft.tags);
  await writableColumnCard.getByRole("button", { name: "Save column" }).click();
  await page.waitForTimeout(1500);
  const columnAfterRestore = await fetchJson(
    page,
    `/api/assets/${WRITABLE_ASSET_FQN}?sections=schema&_qa=${Date.now()}`,
  );
  const restoredColumn =
    (columnAfterRestore.json?.columns || []).find((column) => column.name === WRITABLE_COLUMN_NAME) || null;
  const restoredTagLabels = restoredColumn?.tagLabels || [];
  pushCheck(
    "schema-column-restore",
    columnAfterRestore.ok &&
      String(restoredColumn?.description || "") === String(originalWritableColumnDraft.description || "") &&
      !restoredTagLabels.some((tag) => String(tag).includes(`qa_probe=${suffix}`))
      ? "ok"
      : "warn",
    {
      restoredTo: originalWritableColumnDraft,
      apiColumn: restoredColumn,
    },
  );

  await page.locator(".gh-entity-record-tabs .gh-subtab", { hasText: /^Lineage$/ }).click();
  await page.waitForTimeout(3500);
  await screenshot(page, "entity-lineage-tab");
  const entityLineage = await page.evaluate(() => ({
    nodeCount: document.querySelectorAll(".react-flow__node").length,
    edgeCount: document.querySelectorAll(".react-flow__edge").length,
    hasBlankCanvas:
      Boolean(document.querySelector(".gh-lineage-stage-shell")) &&
      document.querySelectorAll(".react-flow__node").length === 0,
  }));
  pushCheck(
    "entity-lineage-tab",
    entityLineage.nodeCount > 0 ? "ok" : "warn",
    entityLineage,
  );

  await page.getByRole("button", { name: "Open full graph" }).click();
  await page.waitForSelector(".gh-lineage-stage-shell", { timeout: 15000 });
  await page.waitForTimeout(2200);
  await screenshot(page, "lineage-full-graph");
  const fullLineage = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".react-flow__node")].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        text: node.textContent.trim(),
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    });
    let overlaps = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        if (a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top) {
          continue;
        }
        overlaps += 1;
      }
    }
    return {
      nodeCount: nodes.length,
      edgeCount: document.querySelectorAll(".react-flow__edge").length,
      overlaps,
      drawerTitle: document.querySelector(".gh-lineage-drawer-head")?.textContent?.trim() || "",
    };
  });
  pushCheck(
    "lineage-full-graph",
    fullLineage.nodeCount > 0 && fullLineage.overlaps === 0 ? "ok" : "warn",
    fullLineage,
  );

  await gotoSurface(
    page,
    `${BASE_URL}/?module=governance&surface=governance&asset=${ASSET_FQN}&_cb=codex-qa-governance-${suffix}`,
    ".gh-governance-workbench",
  );
  await page.waitForTimeout(1500);
  await page.locator('input[placeholder="Request title"]').fill(requestTitle);
  await page.locator('textarea[placeholder="Optional note"]').fill(requestNote);
  await page.getByRole("button", { name: "Create request" }).click();
  await page.waitForTimeout(1800);
  const governanceAfterRequest = await fetchJson(page, `/api/governance/summary?_qa=${Date.now()}`);
  const requestMatch =
    (governanceAfterRequest.json?.backlog || []).find((item) => item.title === requestTitle) || null;
  createdRequestId = requestMatch?.requestId || "";
  pushCheck(
    "governance-request-create",
    createdRequestId ? "ok" : "warn",
    { requestId: createdRequestId, requestMatch },
  );

  const selectedWorkRejectButton = page
    .locator(".gh-detail-section")
    .filter({ hasText: "Selected work" })
    .getByRole("button", { name: "Reject" })
    .first();
  const requestRow = page.locator(".gh-request-row").filter({ hasText: requestTitle }).first();
  if (await selectedWorkRejectButton.count()) {
    await selectedWorkRejectButton.click();
    await page.waitForTimeout(1800);
    const governanceAfterReject = await fetchJson(page, `/api/governance/summary?_qa=${Date.now()}`);
    const requestStillOpen = (governanceAfterReject.json?.backlog || []).some(
      (item) => item.requestId === createdRequestId || item.title === requestTitle,
    );
    pushCheck("governance-request-reject", requestStillOpen ? "warn" : "ok", {
      requestId: createdRequestId,
      requestStillOpen,
    });
  } else if (await requestRow.count()) {
    await requestRow.click();
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Reject" }).click();
    await page.waitForTimeout(1800);
    const governanceAfterReject = await fetchJson(page, `/api/governance/summary?_qa=${Date.now()}`);
    const requestStillOpen = (governanceAfterReject.json?.backlog || []).some(
      (item) => item.requestId === createdRequestId || item.title === requestTitle,
    );
    pushCheck("governance-request-reject", requestStillOpen ? "warn" : "ok", {
      requestId: createdRequestId,
      requestStillOpen,
    });
  } else {
    pushCheck("governance-request-reject", "warn", {
      requestId: createdRequestId,
      reason: "Neither the selected-work reject action nor the request row was visible after creation.",
    });
  }

  const glossaryCreateBlock = page.locator(".gh-form-block").filter({ hasText: "Create glossary term" });
  await glossaryCreateBlock.locator('input[placeholder="Term name"]').fill(glossaryName);
  await glossaryCreateBlock.locator('textarea[placeholder="Definition"]').fill(glossaryDefinition);
  await glossaryCreateBlock.locator('input[placeholder="Domain"]').fill("Finance");
  await glossaryCreateBlock.locator('input[placeholder="Owner email"]').fill(glossaryOwner);
  await glossaryCreateBlock.locator('input[placeholder="draft"]').fill("draft");
  await glossaryCreateBlock
    .locator('textarea[placeholder*="Initial reviewers"]')
    .fill(glossaryReviewerInitial);
  await glossaryCreateBlock.locator('textarea[placeholder="Optional creation note"]').fill(`Created ${suffix}`);
  await glossaryCreateBlock.getByRole("button", { name: "Create term" }).click();
  await page.waitForTimeout(2200);
  const glossaryAfterCreate = await fetchJson(page, `/api/governance/glossary?_qa=${Date.now()}`);
  const glossaryMatch =
    (glossaryAfterCreate.json?.glossary || []).find((item) => item.title === glossaryName) || null;
  createdGlossaryTermId = glossaryMatch?.termId || glossaryMatch?.id || "";
  pushCheck(
    "glossary-create",
    createdGlossaryTermId ? "ok" : "warn",
    { termId: createdGlossaryTermId, glossaryMatch },
  );

  if (createdGlossaryTermId) {
    const glossarySaveButton = page.getByRole("button", { name: "Save term" }).first();
    if (!(await glossarySaveButton.count())) {
      const glossaryModeButton = page.getByRole("button", { name: "Glossary" }).first();
      if (await glossaryModeButton.count()) {
        await glossaryModeButton.click();
        await page.waitForTimeout(1200);
      }
      const glossaryRow = page.locator(".gh-request-row").filter({ hasText: glossaryName }).first();
      if (await glossaryRow.count()) {
        await glossaryRow.click();
        await page.waitForTimeout(1000);
      }
    }
    await page.locator('.gh-metadata-edit-field:has-text("Definition") textarea').fill(glossaryDefinitionUpdated);
    await page.locator('.gh-metadata-edit-field:has-text("Reviewer roster") textarea').fill(glossaryReviewerUpdated);
    await page.locator('.gh-metadata-edit-field:has-text("Change note") textarea').fill(`Edited ${suffix}`);
    await page.getByRole("button", { name: "Save term" }).click();
    await page.waitForTimeout(2200);
    const glossaryAfterEdit = await fetchJson(page, `/api/governance/glossary?_qa=${Date.now()}`);
    const glossaryEdited =
      (glossaryAfterEdit.json?.glossary || []).find((item) => item.title === glossaryName) || null;
    const reviewerRoles = (glossaryEdited?.reviewerRoster || []).map((reviewer) =>
      `${reviewer.email || reviewer.reviewerEmail || ""}:${reviewer.role || reviewer.reviewerRole || ""}`,
    );
    pushCheck(
      "glossary-edit",
      glossaryEdited &&
        String(glossaryEdited.definition || glossaryEdited.detail || "").includes(glossaryDefinitionUpdated) &&
        reviewerRoles.some((entry) => entry.includes("approver")) &&
        (glossaryEdited.termHistory || []).length > 0
        ? "ok"
        : "warn",
      {
      termId: createdGlossaryTermId,
      glossaryEdited,
      reviewerRoles,
    },
    );
  } else {
    pushCheck("glossary-edit", "warn", {
      termId: createdGlossaryTermId,
      reason: "Created glossary term was not returned by the glossary API.",
    });
  }

  await fs.writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  pushCheck("suite-error", "error", {
    message: error?.message || String(error),
    stack: error?.stack || "",
  });
  await fs.writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
