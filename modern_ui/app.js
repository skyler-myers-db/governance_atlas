(function () {
  let DATA = window.GOVHUB_DATA || null;
  const API_BASE = window.GOVHUB_API_BASE || (DATA && DATA.apiBase) || "/api";
  const USE_REMOTE_API = Boolean(window.GOVHUB_USE_REMOTE_API);
  const STORE_KEY = "govhub-modern-ui-state-v1";
  const detailCache = Object.create(null);
  const detailPromises = Object.create(null);
  const graphCache = Object.create(null);
  const graphPromises = Object.create(null);
  let bootstrapPromise = null;

  const els = {};

  const defaultState = () => ({
    module: "discovery",
    selectedAssetFqn: (DATA && DATA.assets && DATA.assets[0] && DATA.assets[0].fqn) || "",
    discovery: {
      query: (DATA && DATA.discovery && DATA.discovery.defaultQuery) || "",
      selectedCatalogs: ["All catalogs"],
      selectedDomains: ["All domains"],
      selectedTiers: ["All tiers"],
      selectedCertifications: ["All certifications"],
      selectedSensitivities: ["All sensitivities"],
      selectedViews: ["All assets"],
      sortBy: "Best match",
      tab: "Overview",
    },
    lineage: {
      context: "Data Lineage",
      depth: 2,
      selectedNodeId: "focus",
    },
    governance: {
      tab: "Overview",
    },
  });

  let state = loadState();

  function loadState() {
    const base = defaultState();
    try {
      const stored = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      return mergeState(base, stored);
    } catch {
      return base;
    }
  }

  function mergeState(base, patch) {
    return {
      ...base,
      ...patch,
      discovery: { ...base.discovery, ...(patch.discovery || {}) },
      lineage: { ...base.lineage, ...(patch.lineage || {}) },
      governance: { ...base.governance, ...(patch.governance || {}) },
    };
  }

  function saveState() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function assetByFqn(fqn) {
    if (!DATA || !DATA.assets || !DATA.assets.length) return null;
    return DATA.assetIndex[fqn] || DATA.assets[0];
  }

  function formatList(value) {
    return value.join(", ");
  }

  function isDefaultSelection(value, defaultLabel) {
    return value.length === 1 && value[0] === defaultLabel;
  }

  function shouldApplyFilter(selected, defaultLabel) {
    return !(selected.length === 0 || isDefaultSelection(selected, defaultLabel));
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function pluralize(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function formatCount(value) {
    return Number(value).toLocaleString("en-US");
  }

  function normalize(str) {
    return String(str || "").trim().toLowerCase();
  }

  function searchScore(asset, query) {
    const q = normalize(query);
    if (!q) return asset.coverageScore;
    const haystack = normalize(
      [
        asset.name,
        asset.description,
        asset.catalog,
        asset.schema,
        asset.domain,
        asset.tags.join(" "),
        asset.objectType,
      ].join(" ")
    );
    let score = asset.coverageScore;
    if (haystack.includes(q)) score += 85;
    if (normalize(asset.name).includes(q)) score += 40;
    if (normalize(asset.description).includes(q)) score += 20;
    if (normalize(asset.catalog).includes(q)) score += 15;
    return score;
  }

  function selectedMatches(selected, candidate, defaultLabel) {
    return !shouldApplyFilter(selected, defaultLabel) || selected.includes(candidate);
  }

  function assetMatches(asset) {
    const d = state.discovery;
    const query = normalize(d.query);
    if (query) {
      const haystack = normalize(
        [
          asset.name,
          asset.description,
          asset.catalog,
          asset.schema,
          asset.domain,
          asset.tags.join(" "),
          asset.objectType,
          asset.tier,
          asset.certification,
          asset.sensitivity,
        ].join(" ")
      );
      if (!haystack.includes(query)) return false;
    }
    if (shouldApplyFilter(d.selectedCatalogs, "All catalogs") && !d.selectedCatalogs.includes(asset.catalog)) {
      return false;
    }
    if (shouldApplyFilter(d.selectedDomains, "All domains") && !d.selectedDomains.includes(asset.domain)) {
      return false;
    }
    if (shouldApplyFilter(d.selectedTiers, "All tiers") && !d.selectedTiers.includes(asset.tier)) {
      return false;
    }
    if (
      shouldApplyFilter(d.selectedCertifications, "All certifications") &&
      !d.selectedCertifications.includes(asset.certification)
    ) {
      return false;
    }
    if (
      shouldApplyFilter(d.selectedSensitivities, "All sensitivities") &&
      !d.selectedSensitivities.includes(asset.sensitivity)
    ) {
      return false;
    }
    if (shouldApplyFilter(d.selectedViews, "All assets")) {
      const matchesView = d.selectedViews.some((view) => {
        if (view === "Certified") return asset.certification === "Certified";
        if (view === "Needs owner") return asset.owners.length === 0;
        if (view === "Needs certification") return asset.certification !== "Certified";
        if (view === "High coverage") return asset.coverageScore >= 70;
        return view === "All assets";
      });
      if (!matchesView) return false;
    }
    return true;
  }

  function filteredAssets() {
    if (!DATA || !DATA.assets) return [];
    const rows = DATA.assets.filter(assetMatches);
    const d = state.discovery;
    const sortBy = d.sortBy;
    rows.sort((a, b) => {
      if (sortBy === "Coverage score") return b.coverageScore - a.coverageScore;
      if (sortBy === "Open requests") return b.openRequests - a.openRequests || b.coverageScore - a.coverageScore;
      if (sortBy === "Recently updated") return b.coverageScore - a.coverageScore;
      return searchScore(b, d.query) - searchScore(a, d.query);
    });
    return rows;
  }

  function currentAsset() {
    const summary = assetByFqn(state.selectedAssetFqn);
    if (!summary) return null;
    return {
      ...summary,
      ...(detailCache[summary.fqn] || {}),
      preview: (detailCache[summary.fqn] && detailCache[summary.fqn].preview) || summary.preview || [],
      columns: (detailCache[summary.fqn] && detailCache[summary.fqn].columns) || summary.columns || [],
      relatedAssets:
        (detailCache[summary.fqn] && detailCache[summary.fqn].relatedAssets) ||
        summary.relatedAssets ||
        [],
    };
  }

  async function fetchJson(path) {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();
  }

  async function ensureBootstrap() {
    const liveVersion =
      DATA && typeof DATA.version === "string" && DATA.version.startsWith("modern-ui-live");
    if (!USE_REMOTE_API && DATA && DATA.assets && DATA.assets.length) return DATA;
    if (USE_REMOTE_API && liveVersion && DATA && DATA.assets && DATA.assets.length) return DATA;
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = fetchJson("/bootstrap")
      .then((payload) => {
        const base = DATA || {};
        DATA = {
          ...base,
          ...payload,
          discovery: { ...(base.discovery || {}), ...(payload.discovery || {}) },
          governance: { ...(base.governance || {}), ...(payload.governance || {}) },
          shell: { ...(base.shell || {}), ...(payload.shell || {}) },
          graphs: { ...(base.graphs || {}), ...(payload.graphs || {}) },
          help: payload.help || base.help || [],
          assets: payload.assets || base.assets || [],
        };
        DATA.assetIndex = Object.fromEntries((DATA.assets || []).map((asset) => [asset.fqn, asset]));
        return DATA;
      })
      .finally(() => {
        bootstrapPromise = null;
      });
    return bootstrapPromise;
  }

  async function ensureAssetDetail(fqn) {
    if (!fqn || !USE_REMOTE_API) return currentAsset();
    if (detailCache[fqn]) return detailCache[fqn];
    if (detailPromises[fqn]) return detailPromises[fqn];
    detailPromises[fqn] = fetchJson(`/assets/${encodeURIComponent(fqn)}`)
      .then((detail) => {
        detailCache[fqn] = detail;
        if (DATA && DATA.assetIndex && DATA.assetIndex[fqn]) {
          DATA.assetIndex[fqn] = { ...DATA.assetIndex[fqn], ...detail };
          DATA.assets = DATA.assets.map((asset) =>
            asset.fqn === fqn ? { ...asset, ...detail } : asset
          );
        }
        if (state.selectedAssetFqn === fqn) renderApp();
        return detail;
      })
      .finally(() => {
        delete detailPromises[fqn];
      });
    return detailPromises[fqn];
  }

  async function ensureLineageGraph(fqn) {
    if (!fqn || !USE_REMOTE_API) return null;
    if (graphCache[fqn]) return graphCache[fqn];
    if (graphPromises[fqn]) return graphPromises[fqn];
    graphPromises[fqn] = fetchJson(`/lineage/${encodeURIComponent(fqn)}`)
      .then((payload) => {
        graphCache[fqn] = payload.graphs || {};
        if (DATA) {
          DATA.graphs = DATA.graphs || {};
          DATA.graphs[fqn] = graphCache[fqn];
        }
        if (state.selectedAssetFqn === fqn && state.module === "lineage") renderApp();
        return graphCache[fqn];
      })
      .finally(() => {
        delete graphPromises[fqn];
      });
    return graphPromises[fqn];
  }

  function renderMetricCards(target, metrics) {
    target.innerHTML = metrics
      .map(
        (metric) => `
        <div class="metric-card">
          <div class="metric-label">${escapeHtml(metric.label)}</div>
          <div class="metric-value" data-count-up="${escapeHtml(metric.value)}">${formatCount(metric.value)}</div>
        </div>
      `
      )
      .join("");
  }

  function renderShellMetrics() {
    const target = els.shellMetrics;
    if (!target) return;
    const shell = (DATA && DATA.shell) || {};
    renderMetricCards(target, shell.metrics || []);
    const roleNode = document.getElementById("shell-role");
    const userNode = document.getElementById("shell-user-email");
    if (roleNode) roleNode.textContent = shell.role || "Reader";
    if (userNode) userNode.textContent = shell.userEmail || "unknown";
    animateCounters(target);
  }

  function renderHelpGrid() {
    if (!els.helpGrid) return;
    const items = (DATA && DATA.help) || [];
    els.helpGrid.innerHTML = items
      .map(
        (item) => `
          <div class="help-item">
            <div class="title">${escapeHtml(item.title)}</div>
            <div class="body">${escapeHtml(item.body)}</div>
          </div>
        `
      )
      .join("");
  }

  function renderApp() {
    els.appMain = els.appMain || document.getElementById("app-main");
    els.moduleSwitcher = els.moduleSwitcher || document.getElementById("module-switcher");
    els.helpDialog = els.helpDialog || document.getElementById("help-dialog");
    els.helpGrid = els.helpGrid || document.getElementById("help-grid");
    els.shellMetrics = els.shellMetrics || document.getElementById("shell-metrics");

    renderShellMetrics();
    renderHelpGrid();

    if (!DATA || !DATA.assets || !DATA.assets.length) {
      const bootState = (DATA && DATA.bootState) || "";
      const bootMessage = (DATA && DATA.bootMessage) || "";
      const title =
        bootState === "unavailable"
          ? "Modern workspace unavailable"
          : bootState === "error"
            ? "Modern workspace failed to load"
            : DATA
              ? "No visible assets"
              : "Loading workspace";
      const copy =
        bootMessage ||
        (bootState === "unavailable"
          ? "The modern runtime could not access the live metadata plane."
          : bootState === "error"
            ? "The modern frontend failed to load its bootstrap payload."
            : DATA
              ? "No visible assets are currently available to seed the modern workspace."
              : "Preparing the modern metadata workspace.");
      els.appMain.innerHTML = `
        <section class="section-shell workspace-shell">
          <section class="results-panel">
            <div class="panel-title">${escapeHtml(title)}</div>
            <div class="copy">${escapeHtml(copy)}</div>
          </section>
        </section>
      `;
      return;
    }

    document.body.dataset.module = state.module;
    document.querySelectorAll(".module-pill").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.module === state.module);
    });

    if (state.module === "discovery") {
      els.appMain.innerHTML = renderDiscovery();
    } else if (state.module === "lineage") {
      els.appMain.innerHTML = renderLineage();
    } else {
      els.appMain.innerHTML = renderGovernance();
    }
    requestAnimationFrame(() => animateCounters(document));
    syncUrl();
  }

  function renderDiscovery() {
    const assets = filteredAssets();
    const selectedVisible = assets.find((row) => row.fqn === state.selectedAssetFqn);
    const asset = currentAsset() && selectedVisible ? currentAsset() : assets[0] || null;
    if (!asset) {
      return `
        <section class="section-shell workspace-shell">
          <section class="results-panel">
            <div class="panel-title">No visible assets</div>
            <div class="copy">No assets are currently available in this metadata workspace.</div>
          </section>
        </section>
      `;
    }
    if (asset.fqn !== state.selectedAssetFqn) {
      state.selectedAssetFqn = asset.fqn;
      saveState();
    }
    if (USE_REMOTE_API && asset && asset.fqn) void ensureAssetDetail(asset.fqn);
    const d = state.discovery;
    const sortOptions = (DATA.discovery && DATA.discovery.sortOptions) || [];
    const tabs = ["Overview", "Schema", "Preview", "Lineage", "Governance"];
    const currentTab = tabs.includes(d.tab) ? d.tab : "Overview";

    return `
      <section class="section-shell workspace-shell">
        <div class="workspace-rail discovery">
          <aside class="filters-panel">
            <div class="filter-group">
              <div class="filter-title">Search Assets</div>
              <input class="input" data-action="discovery-query" value="${escapeHtml(d.query)}" placeholder="customer, finance, PII, steward email, certified" />
            </div>
            <div class="search-row">
              <div class="filter-group">
                <div class="filter-title">Sort By</div>
                <select class="select" data-action="discovery-sort">
                  ${sortOptions
                    .map(
                      (opt) => `
                        <option ${opt === d.sortBy ? "selected" : ""}>${escapeHtml(opt)}</option>
                      `
                    )
                    .join("")}
                </select>
              </div>
            </div>
            ${renderFilterGroup("Asset View", DATA.discovery.views, d.selectedViews, "discovery-view")}
            ${renderFilterGroup("Catalogs", DATA.discovery.catalogs, d.selectedCatalogs, "discovery-catalog")}
            ${renderFilterGroup("Domains", DATA.discovery.domains, d.selectedDomains, "discovery-domain")}
            ${renderFilterGroup("Tiers", DATA.discovery.tiers, d.selectedTiers, "discovery-tier")}
            ${renderFilterGroup("Certifications", DATA.discovery.certifications, d.selectedCertifications, "discovery-certification")}
            ${renderFilterGroup("Sensitivities", DATA.discovery.sensitivities, d.selectedSensitivities, "discovery-sensitivity")}
            <button class="segment-button" data-action="discovery-apply" type="button">Apply discovery filters</button>
          </aside>

          <section class="results-panel">
            <div class="panel-title">Search Results</div>
            <div class="copy">${assets.length} assets match the current discovery filters.</div>
            <div class="results-grid">
              ${assets.map((row) => renderAssetCard(row, row.fqn === state.selectedAssetFqn)).join("")}
            </div>
          </section>

          <section class="preview-panel">
            ${renderAssetPreviewShell(asset, currentTab)}
          </section>
        </div>
      </section>
    `;
  }

  function renderFilterGroup(title, options, selected, actionBase) {
    return `
      <div class="filter-group">
        <div class="filter-title">${escapeHtml(title)}</div>
        <div class="chip-stack">
          ${options
            .map(
              (opt) => `
                <button
                  class="filter-chip ${selected.includes(opt) ? "is-selected" : ""}"
                  type="button"
                  data-action="${actionBase}"
                  data-value="${escapeHtml(opt)}"
                >${escapeHtml(opt)}</button>
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  function renderAssetCard(asset, selected) {
    const status = asset.governanceStatus || "Needs Work";
    const riskClass =
      status === "Enterprise Ready" ? "good" : status === "Operational" ? "warn" : "bad";
    const badges = [
      asset.objectType,
      asset.domain,
      asset.tier,
      asset.certification,
      asset.sensitivity,
    ];
    return `
      <article class="asset-card ${selected ? "is-selected" : ""}" data-action="asset-select" data-fqn="${escapeHtml(asset.fqn)}">
        <div class="asset-head">
          <div>
            <h3 class="asset-name">${escapeHtml(asset.name)}</h3>
            <div class="asset-context">${escapeHtml(asset.catalog)} / ${escapeHtml(asset.schema)}</div>
          </div>
          <div class="score-card">
            <span class="score-label">Coverage Score</span>
            <span class="score-value" data-count-up="${escapeHtml(asset.coverageScore)}">${escapeHtml(asset.coverageScore)}</span>
          </div>
        </div>
        <div class="copy">${escapeHtml(asset.description)}</div>
        <div class="badge-row">
          <span class="badge ${riskClass}">${escapeHtml(status)}</span>
          ${badges.map((item) => `<span class="badge">${escapeHtml(item)}</span>`).join("")}
        </div>
      </article>
    `;
  }

  function renderAssetPreviewShell(asset, currentTab) {
    const tabs = ["Overview", "Schema", "Preview", "Lineage", "Governance"];
    return `
      <div class="panel-title">Asset Preview</div>
      <div class="tabs">
        ${tabs
          .map(
            (tab) => `
              <button class="tab-button ${tab === currentTab ? "is-active" : ""}" data-action="asset-tab" data-value="${tab}" type="button">${tab}</button>
            `
          )
          .join("")}
      </div>
      ${renderAssetPreviewBody(asset, currentTab)}
    `;
  }

  function renderAssetPreviewBody(asset, tab) {
    const columns = asset.columns || [];
    const previewRows = asset.preview || [];
    const isDetailLoading = USE_REMOTE_API && !detailCache[asset.fqn];

    if (tab === "Schema") {
      return `
        <div class="detail-section">
          <div class="panel-title">Table Metadata</div>
          ${
            columns.length
              ? `
                <table class="table">
                  <thead>
                    <tr><th>Column</th><th>Type</th><th>Description</th></tr>
                  </thead>
                  <tbody>
                    ${columns
                      .map(
                        (col) => `
                          <tr>
                            <td>${escapeHtml(col.name)}</td>
                            <td>${escapeHtml(col.type)}</td>
                            <td>${escapeHtml(col.description)}</td>
                          </tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              `
              : `<div class="detail-note">${
                  isDetailLoading ? "Loading schema metadata..." : "No schema metadata is available for this asset yet."
                }</div>`
          }
        </div>
      `;
    }

    if (tab === "Preview") {
      const keys = Object.keys(previewRows[0] || {});
      return `
        <div class="detail-section">
          <div class="panel-title">Sample Data</div>
          ${
            keys.length
              ? `
                <table class="table">
                  <thead>
                    <tr>${keys.map((key) => `<th>${escapeHtml(key)}</th>`).join("")}</tr>
                  </thead>
                  <tbody>
                    ${previewRows
                      .map(
                        (row) => `
                          <tr>${keys.map((key) => `<td>${escapeHtml(row[key])}</td>`).join("")}</tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              `
              : `<div class="detail-note">${
                  isDetailLoading ? "Loading sample data..." : "Preview rows are not available for this asset."
                }</div>`
          }
        </div>
      `;
    }

    if (tab === "Lineage") {
      const graphBundle = (DATA.graphs && DATA.graphs[asset.fqn]) || graphCache[asset.fqn] || null;
      const lineageGraph = graphBundle && graphBundle.data;
      const upstream = lineageGraph ? countNodes(lineageGraph, "source", 3) : "—";
      const downstream = lineageGraph ? countNodes(lineageGraph, "target", 3) : "—";
      return `
        <div class="detail-section">
          <div class="panel-title">Lineage Summary</div>
          <div class="stat-board">
            <div class="stat-tile"><div class="kicker">Upstream</div><div class="value">${upstream === "—" ? "—" : `${upstream} assets`}</div></div>
            <div class="stat-tile"><div class="kicker">Downstream</div><div class="value">${downstream === "—" ? "—" : `${downstream} assets`}</div></div>
            <div class="stat-tile"><div class="kicker">Related</div><div class="value">${asset.relatedAssets.length} assets</div></div>
            <div class="stat-tile"><div class="kicker">Context</div><div class="value">Data lineage</div></div>
          </div>
          ${
            USE_REMOTE_API && !lineageGraph
              ? `<div class="detail-note">Loading live lineage graph...</div>`
              : ""
          }
          <button class="segment-button" data-action="goto-lineage" data-fqn="${escapeHtml(asset.fqn)}" type="button">Open full lineage workspace</button>
        </div>
      `;
    }

    if (tab === "Governance") {
      return `
        <div class="detail-section">
          <div class="panel-title">Governance Summary</div>
          <div class="stat-board">
            <div class="stat-tile"><div class="kicker">Domain</div><div class="value">${escapeHtml(asset.domain)}</div></div>
            <div class="stat-tile"><div class="kicker">Tier</div><div class="value">${escapeHtml(asset.tier)}</div></div>
            <div class="stat-tile"><div class="kicker">Certification</div><div class="value">${escapeHtml(asset.certification)}</div></div>
            <div class="stat-tile"><div class="kicker">Sensitivity</div><div class="value">${escapeHtml(asset.sensitivity)}</div></div>
          </div>
          <div class="badge-row">
            ${asset.tags.map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}
          </div>
        </div>
      `;
    }

    return `
      <div class="detail-section">
        <div class="panel-title">Asset Profile</div>
        <div class="copy">${escapeHtml(asset.description)}</div>
        <div class="stat-board">
          <div class="stat-tile"><div class="kicker">Rows</div><div class="value">${escapeHtml(asset.rows)}</div></div>
          <div class="stat-tile"><div class="kicker">Format</div><div class="value">${escapeHtml(asset.format)}</div></div>
          <div class="stat-tile"><div class="kicker">Size</div><div class="value">${escapeHtml(asset.size)}</div></div>
          <div class="stat-tile"><div class="kicker">Files</div><div class="value">${escapeHtml(asset.files)}</div></div>
        </div>
        <div class="badge-row">
          ${asset.owners.length
            ? asset.owners.map((owner) => `<span class="badge good">${escapeHtml(owner.name)} · ${escapeHtml(owner.title)}</span>`).join("")
            : `<span class="badge bad">No owners assigned</span>`}
        </div>
        <div class="copy">OpenMetadata link is assumed to be supplied by the backend integration layer when available.</div>
      </div>
    `;
  }

  function renderLineage() {
    const asset = currentAsset() || filteredAssets()[0] || null;
    if (!asset) {
      return `
        <section class="section-shell lineage-shell">
          <section class="results-panel">
            <div class="panel-title">No lineage available</div>
            <div class="copy">No visible assets are currently available to seed the lineage workspace.</div>
          </section>
        </section>
      `;
    }
    if (USE_REMOTE_API && asset && asset.fqn) {
      void ensureAssetDetail(asset.fqn);
      void ensureLineageGraph(asset.fqn);
    }
    const graph = getGraph(asset, state.lineage.context);
    const depth = state.lineage.depth;
    const nodes = graph.nodes.filter((node) => node.depth <= depth);
    const edges = graph.edges.filter((edge) => {
      const source = graph.nodes.find((node) => node.id === edge.source);
      const target = graph.nodes.find((node) => node.id === edge.target);
      return source && target && source.depth <= depth && target.depth <= depth;
    });
    const selectedNode = nodes.find((node) => node.id === state.lineage.selectedNodeId) || graph.nodes[0];
    const selectedAsset =
      (selectedNode && selectedNode.assetFqn && assetByFqn(selectedNode.assetFqn)) || asset;
    const relatedAssets = (selectedAsset && selectedAsset.relatedAssets) || [];
    if (USE_REMOTE_API && selectedNode && selectedNode.assetFqn) {
      void ensureAssetDetail(selectedNode.assetFqn);
    }

    return `
      <section class="section-shell lineage-shell">
        <div class="lineage-toolbar">
          <input class="input" data-action="lineage-search" value="${escapeHtml(asset.fqn)}" />
          <div class="segment-group">
            <button class="segment-button ${state.lineage.context === "Data Lineage" ? "is-active" : ""}" data-action="lineage-context" data-value="Data Lineage" type="button">Data Lineage</button>
            <button class="segment-button ${state.lineage.context === "Operational Context" ? "is-active" : ""}" data-action="lineage-context" data-value="Operational Context" type="button">Operational Context</button>
          </div>
          <div class="segment-group">
            <button class="segment-button ${depth === 1 ? "is-active" : ""}" data-action="lineage-depth" data-value="1" type="button">Depth 1</button>
            <button class="segment-button ${depth === 2 ? "is-active" : ""}" data-action="lineage-depth" data-value="2" type="button">Depth 2</button>
            <button class="segment-button ${depth >= 3 ? "is-active" : ""}" data-action="lineage-depth" data-value="3" type="button">Depth 3</button>
          </div>
          <button class="segment-button" data-action="lineage-open-asset" data-fqn="${escapeHtml(asset.fqn)}" type="button">Open full lineage workspace</button>
        </div>

        <div class="graph-layout">
          <section class="graph-panel">
            <div class="graph-grid"></div>
            <svg class="graph-svg" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true">
              ${edges.map((edge) => renderEdge(graph, edge, depth)).join("")}
            </svg>
            <div class="graph-node-layer">
              ${nodes.map((node) => renderGraphNode(node, node.id === selectedNode.id)).join("")}
            </div>
          </section>

          <aside class="graph-detail">
            <div class="panel-title">Selected Asset</div>
            <h2 class="section-title">${escapeHtml(selectedNode.label || asset.name)}</h2>
            <div class="copy">${escapeHtml(selectedNode.subtitle || asset.catalog + " / " + asset.schema)}</div>
            <div class="badge-row">
              <span class="badge ${selectedNode.role === "focus" ? "good" : "warn"}">${escapeHtml(selectedNode.kicker || selectedNode.kind)}</span>
              <span class="badge">${escapeHtml(selectedNode.kind || asset.objectType)}</span>
              <span class="badge">${escapeHtml(state.lineage.context)}</span>
            </div>
            <div class="detail-stat-grid">
              <div class="detail-stat"><div class="label">Upstream</div><div class="value">${pluralize(countNodes(graph, "source", depth), "asset")}</div></div>
              <div class="detail-stat"><div class="label">Downstream</div><div class="value">${pluralize(countNodes(graph, "target", depth), "asset")}</div></div>
              <div class="detail-stat"><div class="label">Depth</div><div class="value">${depth}</div></div>
              <div class="detail-stat"><div class="label">Context</div><div class="value">${escapeHtml(state.lineage.context)}</div></div>
            </div>
            <div class="detail-section">
              <h3>Detail</h3>
              <div class="detail-note">
                ${escapeHtml(
                  state.lineage.context === "Operational Context"
                    ? "Use the graph to move between jobs, notebooks, queries, and assets. Clicking an asset node refocuses lineage on that asset."
                    : "This view maps direct and indirect producers and consumers. Clicking an asset node refocuses the graph on that entity."
                )}
              </div>
              ${selectedNode.assetFqn ? `<button class="segment-button" data-action="focus-asset" data-fqn="${escapeHtml(selectedNode.assetFqn)}" type="button">Open related asset</button>` : ""}
            </div>
            <div class="detail-section">
              <h3>Related assets</h3>
              <div class="badge-row">
                ${relatedAssets
                  .map((fqn) => {
                    const related = assetByFqn(fqn);
                    if (!related) return "";
                    return `<button class="asset-mini-chip" data-action="focus-asset" data-fqn="${escapeHtml(fqn)}" type="button">${escapeHtml(related.name)} · ${escapeHtml(related.catalog)} / ${escapeHtml(related.schema)}</button>`;
                  })
                  .join("")}
              </div>
            </div>
          </aside>
        </div>
      </section>
    `;
  }

  function getGraph(asset, context) {
    const preset = (graphCache[asset.fqn] || (DATA.graphs && DATA.graphs[asset.fqn])) || null;
    if (preset) return context === "Operational Context" ? preset.operational : preset.data;
    return buildGenericGraph(asset, context);
  }

  function buildGenericGraph(asset, context) {
    const focus = {
      id: "focus",
      assetFqn: asset.fqn,
      label: asset.name,
      subtitle: `${asset.catalog} / ${asset.schema}`,
      kicker: "Focus",
      kind: asset.objectType,
      role: "focus",
      depth: 0,
      x: 50,
      y: 50,
      foot: [asset.certification, asset.domain],
    };
    const upstream = {
      id: "up-1",
      label: `${asset.name} upstream source`,
      subtitle: `${asset.catalog} / ${asset.schema}`,
      kicker: "Source",
      kind: "Table",
      role: "source",
      depth: 1,
      x: 21,
      y: 36,
      foot: ["Live metadata"],
    };
    const downstream = {
      id: "down-1",
      label: `${asset.name} downstream consumer`,
      subtitle: `${asset.catalog} / ${asset.schema}`,
      kicker: "Target",
      kind: "View",
      role: "target",
      depth: 1,
      x: 79,
      y: 36,
      foot: ["Consuming asset"],
    };
    const sibling = {
      id: "down-2",
      label: `${asset.name}_analytics`,
      subtitle: `${asset.catalog} / ${asset.schema}`,
      kicker: "Target",
      kind: "Notebook",
      role: "target",
      depth: 2,
      x: 79,
      y: 66,
      foot: ["Adjacent analysis"],
    };
    return {
      nodes: [focus, upstream, downstream, sibling],
      edges: [
        { source: "up-1", target: "focus", depth: 1 },
        { source: "focus", target: "down-1", depth: 1 },
        { source: "focus", target: "down-2", depth: 2 },
      ],
    };
  }

  function renderEdge(graph, edge, depth) {
    const source = graph.nodes.find((node) => node.id === edge.source);
    const target = graph.nodes.find((node) => node.id === edge.target);
    if (!source || !target) return "";
    const focus = source.role === "focus" || target.role === "focus";
    const d = pathFor(source, target);
    return `<path class="edge-path ${focus ? "focused" : ""}" d="${d}"></path>`;
  }

  function pathFor(source, target) {
    const sx = source.x * 10;
    const sy = source.y * 10;
    const tx = target.x * 10;
    const ty = target.y * 10;
    const dx = Math.max(Math.abs(tx - sx) * 0.45, 110);
    const c1x = sx + (tx > sx ? dx : -dx);
    const c2x = tx - (tx > sx ? dx : -dx);
    return `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`;
  }

  function renderGraphNode(node, active) {
    return `
      <article
        class="graph-node ${node.role === "focus" ? "focus" : ""} ${active ? "is-active" : ""}"
        style="left:${node.x}%; top:${node.y}%;"
        data-action="graph-node"
        data-node-id="${escapeHtml(node.id)}"
        ${node.assetFqn ? `data-fqn="${escapeHtml(node.assetFqn)}"` : ""}
      >
        <div class="node-kicker">${escapeHtml(node.kicker || node.kind)}</div>
        <div class="node-title">${escapeHtml(node.label)}</div>
        <div class="node-meta">${escapeHtml(node.subtitle || "")}</div>
        <div class="node-foot">${(node.foot || []).map((item) => `<span class="badge">${escapeHtml(item)}</span>`).join("")}</div>
      </article>
    `;
  }

  function countNodes(graph, role, depth) {
    return graph.nodes.filter((node) => node.role === role && node.depth <= depth).length;
  }

  function renderGovernance() {
    const asset = currentAsset() || filteredAssets()[0] || null;
    if (!asset) {
      return `
        <section class="section-shell governance-shell">
          <section class="governance-summary">
            <div class="panel-title">Governance Summary</div>
            <div class="copy">No assets are currently visible in the governance workspace.</div>
          </section>
        </section>
      `;
    }
    return `
      <section class="section-shell governance-shell">
        <section class="governance-summary">
          <div class="panel-title">Governance Summary</div>
          <div class="stat-board">
            ${DATA.governance.metrics
              .map(
                (metric) => `
                  <div class="stat-tile">
                    <div class="kicker">${escapeHtml(metric.label)}</div>
                    <div class="value" data-count-up="${escapeHtml(metric.value)}">${formatCount(metric.value)}</div>
                  </div>
                `
              )
              .join("")}
          </div>
          <div class="detail-section">
            <h3>Governance posture</h3>
            <div class="detail-note">
              Governance Hub keeps the live metadata plane in Unity Catalog, with stewardship
              workflow and glossary data persisted in the governance schema.
            </div>
          </div>
          <div class="badge-row">
            <span class="badge good">${escapeHtml(asset.certification)}</span>
            <span class="badge">${escapeHtml(asset.domain)}</span>
            <span class="badge">${escapeHtml(asset.tier)}</span>
          </div>
        </section>

        <section class="governance-feed">
          <div class="panel-title">Open Requests</div>
          <div class="request-list">
            ${DATA.governance.backlog
              .map(
                (item) => `
                  <article class="request-card">
                    <div class="request-top">
                      <h3 class="request-title">${escapeHtml(item.title)}</h3>
                      <span class="badge warn">${escapeHtml(item.status)}</span>
                    </div>
                    <div class="request-meta">${escapeHtml(item.asset)}</div>
                    <div class="copy">${escapeHtml(item.note)}</div>
                    <div class="badge-row">
                      <button class="asset-mini-chip" data-action="focus-asset" data-fqn="${escapeHtml(item.asset)}" type="button">Open asset</button>
                    </div>
                  </article>
                `
              )
              .join("")}
          </div>
          <div class="detail-section">
            <h3>Glossary</h3>
            <table class="table">
              <thead>
                <tr><th>Term</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                ${DATA.governance.glossary
                  .map(
                    (row) => `
                      <tr>
                        <td>${escapeHtml(row.term)}</td>
                        <td>${escapeHtml(row.definition)}</td>
                      </tr>
                    `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    `;
  }

  function animateCounters(root) {
    const nodes = root.querySelectorAll("[data-count-up]");
    nodes.forEach((node) => {
      if (node.dataset.countAnimated === "1") return;
      const target = Number(node.dataset.countUp);
      if (!Number.isFinite(target)) return;
      node.dataset.countAnimated = "1";
      const final = node.textContent || String(target);
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        node.textContent = final;
        return;
      }
      const start = performance.now();
      const duration = 900 + Math.min(Math.abs(target), 900) * 0.28;
      const step = (now) => {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        node.textContent = formatCount(Math.round(target * eased));
        if (t < 1) requestAnimationFrame(step);
        else node.textContent = final;
      };
      requestAnimationFrame(step);
    });
  }

  function syncModule(nextModule) {
    state.module = nextModule;
    saveState();
    renderApp();
  }

  function setSelectedAsset(fqn) {
    state.selectedAssetFqn = fqn;
    state.discovery.tab = "Overview";
    state.lineage.selectedNodeId = "focus";
    saveState();
    renderApp();
    if (USE_REMOTE_API && fqn) {
      void ensureAssetDetail(fqn);
    }
  }

  function toggleChip(listName, value, defaultLabel) {
    const current = state.discovery[listName];
    if (value === defaultLabel) {
      state.discovery[listName] = [defaultLabel];
    } else {
      const set = new Set(current.filter((item) => item !== defaultLabel));
      if (set.has(value)) set.delete(value);
      else set.add(value);
      state.discovery[listName] = set.size ? Array.from(set) : [defaultLabel];
    }
    saveState();
    renderApp();
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      if (action === "help-open") {
        document.getElementById("help-dialog").showModal();
        return;
      }
      if (action === "asset-select") {
        setSelectedAsset(target.dataset.fqn);
        return;
      }
      if (action === "asset-tab") {
        state.discovery.tab = target.dataset.value;
        saveState();
        renderApp();
        return;
      }
      if (action === "goto-lineage" || action === "lineage-open-asset") {
        state.module = "lineage";
        state.lineage.selectedNodeId = "focus";
        state.selectedAssetFqn = target.dataset.fqn || state.selectedAssetFqn;
        saveState();
        renderApp();
        return;
      }
      if (action === "focus-asset") {
        state.selectedAssetFqn = target.dataset.fqn;
        state.module = state.module === "lineage" ? "lineage" : "discovery";
        state.lineage.selectedNodeId = "focus";
        saveState();
        renderApp();
        return;
      }
      if (action === "lineage-context") {
        state.lineage.context = target.dataset.value;
        state.lineage.selectedNodeId = "focus";
        saveState();
        renderApp();
        return;
      }
      if (action === "lineage-depth") {
        state.lineage.depth = Number(target.dataset.value);
        saveState();
        renderApp();
        return;
      }
      if (action === "graph-node") {
        const nodeId = target.dataset.nodeId;
        state.lineage.selectedNodeId = nodeId;
        const graph = getGraph(currentAsset(), state.lineage.context);
        const node = graph.nodes.find((row) => row.id === nodeId);
        if (node && node.assetFqn) {
          state.selectedAssetFqn = node.assetFqn;
        }
        saveState();
        renderApp();
        return;
      }
      if (action === "discovery-apply") {
        renderApp();
        return;
      }
      if (action === "discovery-view") {
        toggleChip("selectedViews", target.dataset.value, "All assets");
        return;
      }
      if (action === "discovery-catalog") {
        toggleChip("selectedCatalogs", target.dataset.value, "All catalogs");
        return;
      }
      if (action === "discovery-domain") {
        toggleChip("selectedDomains", target.dataset.value, "All domains");
        return;
      }
      if (action === "discovery-tier") {
        toggleChip("selectedTiers", target.dataset.value, "All tiers");
        return;
      }
      if (action === "discovery-certification") {
        toggleChip("selectedCertifications", target.dataset.value, "All certifications");
        return;
      }
      if (action === "discovery-sensitivity") {
        toggleChip("selectedSensitivities", target.dataset.value, "All sensitivities");
        return;
      }
      if (action === "module-switch") {
        syncModule(target.dataset.module);
      }
    });

    document.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (target.dataset.action === "discovery-query") {
        state.discovery.query = target.value;
        saveState();
        renderApp();
      }
      if (target.dataset.action === "lineage-search") {
        const match = DATA.assets.find((row) => normalize(row.fqn).includes(normalize(target.value)));
        if (match) {
          state.selectedAssetFqn = match.fqn;
          state.lineage.selectedNodeId = "focus";
          saveState();
          renderApp();
        }
      }
    });

    document.addEventListener("change", (event) => {
      const target = event.target;
      if (target instanceof HTMLSelectElement && target.dataset.action === "discovery-sort") {
        state.discovery.sortBy = target.value;
        saveState();
        renderApp();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const dialog = document.getElementById("help-dialog");
        if (dialog.open) dialog.close();
      }
    });

    document.getElementById("module-switcher").addEventListener("click", (event) => {
      const target = event.target.closest("[data-module]");
      if (!target) return;
      syncModule(target.dataset.module);
    });
  }

  function initFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const module = params.get("module");
    const asset = params.get("asset");
    const context = params.get("context");
    if (module && ["discovery", "lineage", "governance"].includes(module)) state.module = module;
    if (asset && DATA && DATA.assetIndex && DATA.assetIndex[asset]) state.selectedAssetFqn = asset;
    if (context && ["Data Lineage", "Operational Context"].includes(context)) {
      state.lineage.context = context;
    }
  }

  function syncUrl() {
    const params = new URLSearchParams();
    params.set("module", state.module);
    params.set("asset", state.selectedAssetFqn);
    params.set("context", state.lineage.context);
    history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }

  function applyRemoteApiAssumptions() {
    if (!USE_REMOTE_API) return;
    // The frontend assumes the following JSON endpoints when the Python backend is wired:
    // /api/discovery/search, /api/assets/:fqn, /api/lineage/:fqn, /api/governance/summary
    // This static bundle falls back to embedded demo data when those endpoints are absent.
  }

  function boot() {
    els.appMain = document.getElementById("app-main");
    els.moduleSwitcher = document.getElementById("module-switcher");
    els.helpDialog = document.getElementById("help-dialog");
    els.helpGrid = document.getElementById("help-grid");
    els.shellMetrics = document.getElementById("shell-metrics");
    initFromUrl();
    applyRemoteApiAssumptions();
    bindEvents();
    ensureBootstrap()
      .catch((error) => {
        console.error("Failed to load modern bootstrap payload", error);
        DATA = {
          ...(DATA || {}),
          bootState: "error",
          bootMessage:
            (error && error.message) || "Failed to load the modern workspace bootstrap payload.",
          assets: (DATA && DATA.assets) || [],
          assetIndex: (DATA && DATA.assetIndex) || {},
          graphs: (DATA && DATA.graphs) || {},
          discovery: (DATA && DATA.discovery) || {},
          governance: (DATA && DATA.governance) || { metrics: [], backlog: [], glossary: [] },
          shell: (DATA && DATA.shell) || { metrics: [], role: "Reader", userEmail: "unknown" },
          help: (DATA && DATA.help) || [],
        };
      })
      .finally(() => {
        state = mergeState(defaultState(), state);
        if (
          DATA &&
          DATA.assets &&
          DATA.assets.length &&
          (!state.selectedAssetFqn || !DATA.assetIndex[state.selectedAssetFqn])
        ) {
          state.selectedAssetFqn = DATA.assets[0].fqn;
        }
        renderApp();
      });
  }

  window.addEventListener("DOMContentLoaded", boot);
})();
