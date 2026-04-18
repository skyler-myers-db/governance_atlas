function bootstrapConfig() {
  if (typeof window === "undefined") return null;
  return window.__GOVHUB_BOOTSTRAP__ || null;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeMetadataEditor(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  return {
    ...config,
    fields: arrayValue(config.fields),
  };
}

function normalizeTagEntries(rawTags) {
  if (Array.isArray(rawTags)) {
    return rawTags
      .map((entry) => {
        if (typeof entry === "string") {
          const label = entry.trim();
          return label ? { name: label, value: "", label } : null;
        }
        const tag = objectValue(entry);
        const name = String(tag.name || tag.key || "").trim();
        const value = String(tag.value || "").trim();
        const label = value ? `${name}=${value}` : name;
        return name ? { name, value, label } : null;
      })
      .filter(Boolean);
  }

  const tagMap = objectValue(rawTags);
  return Object.entries(tagMap)
    .map(([name, value]) => {
      const normalizedName = String(name || "").trim();
      const normalizedValue = String(value || "").trim();
      if (!normalizedName) return null;
      return {
        name: normalizedName,
        value: normalizedValue,
        label: normalizedValue ? `${normalizedName}=${normalizedValue}` : normalizedName,
      };
    })
    .filter(Boolean);
}

function normalizeAssetRecord(asset) {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) return {};
  const operationalContext = objectValue(asset.operationalContext);
  const tagEntries = normalizeTagEntries(asset.tagEntries || asset.tags);
  const tagMap = Object.fromEntries(
    tagEntries.map((entry) => [entry.name, entry.value]),
  );
  const tagLabels = arrayValue(asset.tagLabels)
    .map((label) => String(label || "").trim())
    .filter(Boolean);
  return {
    ...asset,
    owners: arrayValue(asset.owners),
    glossaryTerms: arrayValue(asset.glossaryTerms),
    glossaryLinks: arrayValue(asset.glossaryLinks),
    glossaryTerm: String(asset.glossaryTerm || "").trim(),
    tags: tagLabels.length ? tagLabels : tagEntries.map((entry) => entry.label),
    tagEntries,
    tagMap,
    tagLabels: tagLabels.length ? tagLabels : tagEntries.map((entry) => entry.label),
    relatedAssets: arrayValue(asset.relatedAssets),
    preview: arrayValue(asset.preview),
    columns: arrayValue(asset.columns),
    ownerAssignments: arrayValue(asset.ownerAssignments),
    activity: arrayValue(asset.activity),
    metadataAudit: arrayValue(asset.metadataAudit),
    tableProperties: arrayValue(asset.tableProperties),
    customProperties: arrayValue(asset.customProperties || asset.tableProperties),
    constraints: arrayValue(asset.constraints),
    queries: arrayValue(asset.queries),
    operationalContext: {
      ...operationalContext,
      producers: arrayValue(operationalContext.producers),
      consumers: arrayValue(operationalContext.consumers),
    },
    profiler: objectValue(asset.profiler),
    metadataEditor: normalizeMetadataEditor(asset.metadataEditor),
    loadedSections: arrayValue(asset.loadedSections),
    deferredSections: arrayValue(asset.deferredSections),
  };
}

function normalizeGlossaryReviewer(entry, index = 0) {
  if (typeof entry === "string") {
    const email = entry.trim();
    return {
      id: email || `reviewer-${index}`,
      email,
      role: "Reviewer",
      state: "active",
      reviewedAt: "",
      note: "",
    };
  }

  const reviewer = objectValue(entry);
  const email = String(
    reviewer.email ||
      reviewer.ownerEmail ||
      reviewer.reviewerEmail ||
      reviewer.name ||
      reviewer.reviewedBy ||
      "",
  ).trim();
  const role = String(reviewer.role || reviewer.reviewerRole || "Reviewer").trim() || "Reviewer";
  const state = String(reviewer.state || reviewer.status || "active").trim() || "active";
  return {
    id: reviewer.id || email || `reviewer-${index}`,
    email,
    role,
    state,
    reviewedAt: String(reviewer.reviewedAt || reviewer.updatedAt || "").trim(),
    note: String(reviewer.note || reviewer.reviewNote || "").trim(),
  };
}

function normalizeGlossaryHistoryEntry(entry, index = 0) {
  if (typeof entry === "string") {
    const text = entry.trim();
    return {
      id: `history-${index}`,
      version: `v${index + 1}`,
      title: text,
      changedAt: "",
      changedBy: "",
      status: "",
      note: text,
    };
  }

  const history = objectValue(entry);
  const version = String(history.version || history.revision || history.label || "").trim();
  const title = String(history.title || history.name || history.action || "Term update").trim();
  return {
    id: history.id || history.termVersionId || history.requestId || `history-${index}`,
    version: version || `v${index + 1}`,
    title,
    changedAt: String(history.changedAt || history.createdAt || history.updatedAt || "").trim(),
    changedBy: String(history.changedBy || history.createdBy || history.updatedBy || history.reviewedBy || "").trim(),
    status: String(history.status || history.state || "").trim(),
    note: String(history.note || history.detail || history.reviewNote || history.description || "").trim(),
  };
}

function normalizeGlossaryRecord(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return {};
  const reviewerRoster = arrayValue(item.reviewerRoster || item.reviewerAssignments || item.reviewers).map(
    (entry, index) => normalizeGlossaryReviewer(entry, index),
  );
  const reviewerEmails = reviewerRoster
    .map((entry) => String(entry.email || "").trim())
    .filter(Boolean);
  const historyEntries = arrayValue(
    item.termHistory || item.versionHistory || item.history || item.recentRequests,
  ).map((entry, index) => normalizeGlossaryHistoryEntry(entry, index));

  return {
    ...item,
    reviewers: reviewerEmails,
    reviewerRoster,
    termHistory: historyEntries,
    versionHistory: historyEntries,
    currentVersion:
      String(item.currentVersion || item.version || historyEntries[0]?.version || "").trim(),
    reviewState:
      String(item.reviewState || item.status || historyEntries[0]?.status || "Draft").trim() || "Draft",
  };
}

function normalizeGlossaryTermPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const term = objectValue(payload.term || payload.glossaryTerm || payload.item);
  if (!Object.keys(term).length) return normalizeGlossaryRecord(payload);
  return normalizeGlossaryRecord(term);
}

function normalizeInboxItem(item, index = 0) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return {};
  return {
    notificationId: String(item.notificationId || item.id || `notification-${index}`).trim(),
    eventType: String(item.eventType || "").trim(),
    title: String(item.title || "").trim(),
    detail: String(item.detail || "").trim(),
    assetFqn: String(item.assetFqn || "").trim(),
    assetLabel: String(item.assetLabel || item.assetFqn || "").trim(),
    createdAt: String(item.createdAt || "").trim(),
    createdBy: String(item.createdBy || "").trim(),
    status: String(item.status || "").trim(),
    inboxState: String(item.inboxState || "").trim().toLowerCase(),
  };
}

function normalizeInboxRecord(inbox) {
  if (!inbox || typeof inbox !== "object" || Array.isArray(inbox)) return null;
  return {
    state: String(inbox.state || "").trim(),
    message: String(inbox.message || "").trim(),
    unreadCount: Number.isFinite(Number(inbox.unreadCount))
      ? Math.max(0, Math.trunc(Number(inbox.unreadCount)))
      : 0,
    items: arrayValue(inbox.items).map((item, index) => normalizeInboxItem(item, index)),
  };
}

export function normalizeGovernancePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const provenance = objectValue(payload.provenance);
  const queue = objectValue(payload.queue);
  return {
    ...payload,
    metrics: arrayValue(payload.metrics),
    backlog: arrayValue(payload.backlog),
    activity: arrayValue(payload.activity),
    inbox: normalizeInboxRecord(payload.inbox),
    queue: {
      ...queue,
      laneCounts: objectValue(queue.laneCounts),
    },
    glossary: arrayValue(payload.glossary).map((item) => normalizeGlossaryRecord(item)),
    authoritative: payload.authoritative === true,
    provenance: {
      ...provenance,
      warnings: arrayValue(provenance.warnings),
    },
  };
}

function normalizeAssetIndex(assetIndex) {
  return Object.fromEntries(
    Object.entries(objectValue(assetIndex)).map(([assetFqn, asset]) => [assetFqn, normalizeAssetRecord(asset)]),
  );
}

function normalizeBootstrapContract(contract) {
  const normalized = objectValue(contract);
  return {
    ...normalized,
    warnings: arrayValue(normalized.warnings),
  };
}

function normalizeBootstrapPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const discovery = objectValue(payload.discovery);
  const governance = normalizeGovernancePayload(objectValue(payload.governance));
  return {
    ...payload,
    assets: arrayValue(payload.assets).map((asset) => normalizeAssetRecord(asset)),
    assetIndex: normalizeAssetIndex(payload.assetIndex),
    graphs: objectValue(payload.graphs),
    discovery: {
      ...discovery,
      catalogs: arrayValue(discovery.catalogs),
      domains: arrayValue(discovery.domains),
      tiers: arrayValue(discovery.tiers),
      certifications: arrayValue(discovery.certifications),
      sensitivities: arrayValue(discovery.sensitivities),
      views: arrayValue(discovery.views),
      sortOptions: arrayValue(discovery.sortOptions),
      assetTypes: arrayValue(discovery.assetTypes),
      summary: objectValue(discovery.summary),
    },
    governance,
    shell: objectValue(payload.shell),
    identity: objectValue(payload.identity),
    routeHints: objectValue(payload.routeHints),
    featureFlags: arrayValue(payload.featureFlags),
    bootstrapContract: normalizeBootstrapContract(payload.bootstrapContract),
    apiContract: objectValue(payload.apiContract),
    help: arrayValue(payload.help),
  };
}

function normalizeRuntimeStatusPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const diagnostics = objectValue(payload.diagnostics);
  const setupSummary = objectValue(diagnostics.setupSummary);
  const auth = objectValue(diagnostics.auth);
  return {
    ...payload,
    runtime: objectValue(payload.runtime),
    store: objectValue(payload.store),
    capabilities: objectValue(payload.capabilities),
    config: objectValue(payload.config),
    identity: objectValue(payload.identity),
    diagnostics: {
      ...diagnostics,
      setupSummary,
      auth,
      setupChecks: arrayValue(diagnostics.setupChecks),
      featureFlags: arrayValue(diagnostics.featureFlags),
    },
  };
}

function normalizeDiscoveryPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const queryState = objectValue(payload.queryState);
  return {
    ...payload,
    assets: arrayValue(payload.assets).map((asset) => normalizeAssetRecord(asset)),
    facets: objectValue(payload.facets),
    queryState: {
      ...queryState,
      state: String(queryState.state || "").trim().toLowerCase(),
      message: String(queryState.message || "").trim(),
      syntaxHint: String(queryState.syntaxHint || "").trim(),
      supportedFields: arrayValue(queryState.supportedFields)
        .map((field) => String(field || "").trim())
        .filter(Boolean),
      clauseChips: arrayValue(queryState.clauseChips)
        .map((chip) => {
          const normalizedChip = objectValue(chip);
          const label = String(
            normalizedChip.label || normalizedChip.expression || "",
          ).trim();
          if (!label) return null;
          return {
            label,
            expression: String(normalizedChip.expression || label).trim(),
            nextQuery: String(normalizedChip.nextQuery || "").trim(),
            removable: normalizedChip.removable !== false,
          };
        })
        .filter(Boolean),
    },
  };
}

class ApiError extends Error {
  constructor(message, status, payload, meta = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
    this.meta = meta;
    this.httpRequestId = meta.httpRequestId || "";
    this.clientRequestId = meta.clientRequestId || "";
    this.buildId = meta.buildId || "";
    this.durationMs = meta.clientDurationMs || 0;
  }
}

const REQUEST_ID_HEADER = "X-Request-ID";
const CLIENT_REQUEST_ID_HEADER = "X-GovHub-Client-Request-ID";
const BUILD_ID_HEADER = "X-GovHub-Build-ID";
const DURATION_HEADER = "X-GovHub-Request-Duration-Ms";

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function createClientRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function diagnosticsStore() {
  if (typeof window === "undefined") return null;
  const runtimeWindow = /** @type {Window & {
    __GOVHUB_DIAGNOSTICS__?: {
      initialNavigation: unknown,
      lastRequest: unknown,
      requests: unknown[]
    },
    __GOVHUB_NAVIGATION_DIAGNOSTICS_RECORDED__?: boolean
  }} */ (window);
  if (runtimeWindow.__GOVHUB_DIAGNOSTICS__ && typeof runtimeWindow.__GOVHUB_DIAGNOSTICS__ === "object") {
    return runtimeWindow.__GOVHUB_DIAGNOSTICS__;
  }
  runtimeWindow.__GOVHUB_DIAGNOSTICS__ = {
    initialNavigation: null,
    lastRequest: null,
    requests: [],
  };
  return runtimeWindow.__GOVHUB_DIAGNOSTICS__;
}

function recordInitialNavigationTiming() {
  if (typeof window === "undefined") return;
  const runtimeWindow = /** @type {Window & {
    __GOVHUB_DIAGNOSTICS__?: {
      initialNavigation: unknown,
      lastRequest: unknown,
      requests: unknown[]
    },
    __GOVHUB_NAVIGATION_DIAGNOSTICS_RECORDED__?: boolean
  }} */ (window);
  if (runtimeWindow.__GOVHUB_NAVIGATION_DIAGNOSTICS_RECORDED__) return;
  const store = diagnosticsStore();
  if (!store || typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return;
  }
  const navigation = /** @type {PerformanceNavigationTiming | undefined} */ (
    performance.getEntriesByType("navigation")?.[0]
  );
  if (!navigation) return;
  store.initialNavigation = {
    type: navigation.type || "",
    durationMs: Math.round(Number(navigation.duration || 0) * 10) / 10,
    domInteractiveMs: Math.round(Number(navigation.domInteractive || 0) * 10) / 10,
    loadEventEndMs: Math.round(Number(navigation.loadEventEnd || 0) * 10) / 10,
    serverTiming: Array.from(navigation.serverTiming || []).map((entry) => ({
          name: entry?.name || "",
          duration: Number(entry?.duration || 0),
        })),
  };
  runtimeWindow.__GOVHUB_NAVIGATION_DIAGNOSTICS_RECORDED__ = true;
}

function recordRequestDiagnostics(entry) {
  const store = diagnosticsStore();
  if (!store) return;
  store.lastRequest = entry;
  const existing = Array.isArray(store.requests) ? store.requests : [];
  store.requests = [entry, ...existing].slice(0, 25);
}

export function getRuntimeDiagnostics() {
  return diagnosticsStore() || { initialNavigation: null, lastRequest: null, requests: [] };
}

recordInitialNavigationTiming();

function apiBase() {
  return (
    import.meta.env.VITE_GOVHUB_API_BASE ||
    bootstrapConfig()?.apiBase ||
    "/api"
  );
}

function currentLocationSearch(routeContext = null) {
  if (!routeContext && typeof window === "undefined") return "";
  const search = routeContext?.search || (typeof window !== "undefined" ? window.location.search || "" : "");
  const pathname = routeContext?.pathname || (typeof window !== "undefined" ? window.location.pathname || "/" : "/");
  const params = new URLSearchParams(search);
  if (routeContext?.surface) {
    params.set("surface", routeContext.surface);
    if (routeContext.surface === "discovery") {
      params.delete("asset");
      if (routeContext.discoveryQuery?.trim()) params.set("q", routeContext.discoveryQuery.trim());
      else params.delete("q");
    } else if (routeContext.asset) {
      params.set("asset", routeContext.asset);
      params.delete("q");
    } else {
      params.delete("asset");
      params.delete("q");
    }
    params.delete("module");
    const query = params.toString();
    return query ? `?${query}` : "";
  }
  const safeDecode = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const segments = String(pathname || "/")
    .split("/")
    .filter(Boolean);
  const [root, ...rest] = segments;
  if (root === "discovery") {
    params.set("surface", "discovery");
    params.delete("asset");
  } else if (root === "entity" && rest.length) {
    params.set("surface", "entity");
    params.set("asset", safeDecode(rest.join("/")));
  } else if (root === "lineage" && rest.length) {
    params.set("surface", "lineage");
    params.set("asset", safeDecode(rest.join("/")));
  } else if (root === "governance" || root === "glossary") {
    params.set("surface", "governance");
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function buildUrl(path) {
  if (!path) return apiBase();
  if (/^https?:\/\//.test(path)) return path;
  const base = apiBase();
  if (path.startsWith(base)) return path;
  if (path.startsWith("/")) return `${base}${path}`;
  return `${base}/${path}`;
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (response.status === 204) return null;

  try {
    if (contentType.includes("application/json")) {
      return await response.json();
    }
    return await response.text();
  } catch {
    return null;
  }
}

function payloadLooksLikeHtml(payload) {
  if (typeof payload !== "string") return false;
  const sample = payload.trim().slice(0, 240).toLowerCase();
  return sample.startsWith("<!doctype html") || sample.startsWith("<html") || sample.includes("<body");
}

function friendlyHtmlErrorMessage(status, payload) {
  if (!payloadLooksLikeHtml(payload)) return "";
  if (status === 502 || status === 503 || status === 504) {
    return "The Databricks app returned a temporary gateway error while loading live metadata. Retry the action in a moment.";
  }
  return "The app returned an unexpected HTML error page instead of metadata. Retry the action or refresh the workspace.";
}

function responseErrorMessage(status, payload) {
  const htmlMessage = friendlyHtmlErrorMessage(status, payload);
  if (htmlMessage) return htmlMessage;
  if (typeof payload === "string" && payload.trim()) return payload;
  if (payload?.detail) return String(payload.detail);
  if (payload?.message) return String(payload.message);
  return `Request failed: ${status}`;
}

async function request(path, options = {}) {
  const startedAt = nowMs();
  const clientRequestId = options.clientRequestId || createClientRequestId();
  const response = await fetch(buildUrl(path), {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      [CLIENT_REQUEST_ID_HEADER]: clientRequestId,
      ...(options.headers || {}),
    },
    signal: options.signal,
    body: options.body,
  });
  const payload = await parseResponse(response);
  const meta = {
    path: buildUrl(path),
    status: response.status,
    clientRequestId,
    httpRequestId: response.headers.get(REQUEST_ID_HEADER) || "",
    buildId: response.headers.get(BUILD_ID_HEADER) || "",
    serverDurationMs: Number(response.headers.get(DURATION_HEADER) || 0) || 0,
    clientDurationMs: Math.round((nowMs() - startedAt) * 10) / 10,
    receivedAt: new Date().toISOString(),
  };
  recordRequestDiagnostics(meta);
  if (!response.ok) {
    throw new ApiError(responseErrorMessage(response.status, payload), response.status, payload, meta);
  }
  return payload;
}

async function requestJson(path, method, body, options = {}) {
  return request(path, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

function contractPath(...keys) {
  const contract = bootstrapConfig()?.apiContract || {};
  for (const key of keys) {
    const value = contract?.[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function assetRoute(pathTemplate, assetFqn) {
  if (!pathTemplate) return "";
  if (!assetFqn) return pathTemplate;
  const encoded = encodeURIComponent(assetFqn);
  return pathTemplate
    .replaceAll(":fqn", encoded)
    .replaceAll("{fqn}", encoded)
    .replaceAll("[fqn]", encoded);
}

function routeToken(pathTemplate, token, value) {
  if (!pathTemplate) return "";
  if (!value) return pathTemplate;
  const encoded = encodeURIComponent(value);
  return pathTemplate
    .replaceAll(`:${token}`, encoded)
    .replaceAll(`{${token}}`, encoded)
    .replaceAll(`[${token}]`, encoded);
}

function columnRoute(pathTemplate, assetFqn, columnName) {
  if (!pathTemplate) return "";
  const assetEncoded = encodeURIComponent(assetFqn || "");
  const columnEncoded = encodeURIComponent(columnName || "");
  return pathTemplate
    .replaceAll(":fqn", assetEncoded)
    .replaceAll("{fqn}", assetEncoded)
    .replaceAll("[fqn]", assetEncoded)
    .replaceAll(":column", columnEncoded)
    .replaceAll("{column}", columnEncoded)
    .replaceAll("[column]", columnEncoded);
}

function normalizedMethod(value, fallback = "PATCH") {
  return (value || fallback).toString().trim().toUpperCase();
}

export function fetchBootstrap(routeContext = null, options = {}) {
  const bootstrapRouteContext = routeContext
    ? {
        surface: routeContext.surface || "discovery",
        asset: routeContext.asset || "",
      }
    : null;
  const path = contractPath("bootstrap") || "/bootstrap";
  return request(`${path}${currentLocationSearch(bootstrapRouteContext)}`, options).then((payload) =>
    normalizeBootstrapPayload(payload),
  );
}

export function fetchRuntimeStatus(options = {}) {
  const path = contractPath("runtimeStatus") || "/runtime/status";
  return request(path, options).then((payload) => normalizeRuntimeStatusPayload(payload));
}

function appendList(params, key, values) {
  (values || []).forEach((value) => {
    if (!value) return;
    params.append(key, value);
  });
}

export function fetchDiscoverySearch(filters = {}, options = {}) {
  const params = new URLSearchParams();
  if (filters.query) params.set("query", filters.query);
  if (filters.queryMode) params.set("queryMode", filters.queryMode);
  appendList(params, "views", filters.views);
  appendList(params, "types", filters.types);
  if (filters.view) params.set("view", filters.view);
  if (filters.type) params.set("type", filters.type);
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
  appendList(params, "catalogs", filters.catalogs);
  appendList(params, "domains", filters.domains);
  appendList(params, "tiers", filters.tiers);
  appendList(params, "certifications", filters.certifications);
  appendList(params, "sensitivities", filters.sensitivities);
  const query = params.toString();
  const discoveryPath = contractPath("discoverySearch") || "/discovery/search";
  return request(`${discoveryPath}${query ? `?${query}` : ""}`, options).then((payload) =>
    normalizeDiscoveryPayload(payload),
  );
}

export function fetchAssetDetail(assetFqn, options = {}) {
  const params = new URLSearchParams();
  (options.sections || []).forEach((section) => {
    if (section) params.append("sections", section);
  });
  const query = params.toString();
  return request(
    `/assets/${encodeURIComponent(assetFqn)}${query ? `?${query}` : ""}`,
    { signal: options.signal },
  ).then((payload) =>
    normalizeAssetRecord(payload),
  );
}

export function fetchAssetAvailability(assetFqns = [], options = {}) {
  const targets = [...new Set((assetFqns || []).filter(Boolean))];
  if (!targets.length) return Promise.resolve({ assets: {} });
  const path = contractPath("assetAvailability") || "/assets/availability";
  return requestJson(path, "POST", { assets: targets }, { signal: options.signal });
}

export function fetchLineage(assetFqn, options = {}) {
  const path = `/lineage/${encodeURIComponent(assetFqn)}`;
  const execute = () => request(path, { signal: options.signal });
  return execute().catch((error) => {
    if (options.signal?.aborted) {
      throw error;
    }
    if (error?.status === 502 || error?.status === 503 || error?.status === 504) {
      return new Promise((resolve, reject) => {
        const timeoutId = globalThis.setTimeout(() => {
          if (options.signal?.aborted) {
            reject(error);
            return;
          }
          execute().then(resolve).catch(reject);
        }, 650);
        const abortHandler = () => {
          globalThis.clearTimeout(timeoutId);
          reject(error);
        };
        options.signal?.addEventListener?.("abort", abortHandler, { once: true });
      });
    }
    throw error;
  });
}

export function fetchGovernanceSummary(options = {}) {
  return request("/governance/summary", options).then((payload) => normalizeGovernancePayload(payload));
}

export function fetchGovernanceGlossary() {
  return request("/governance/glossary").then((payload) => normalizeGovernancePayload(payload));
}

export function fetchGovernanceAuditTimeline(assetFqn, options = {}) {
  const normalized = String(assetFqn || "").trim();
  if (!normalized) return Promise.resolve({ fqn: "", entries: [], total: 0 });
  return request(`/governance/audit-timeline/${encodeURIComponent(normalized)}`, {
    signal: options.signal,
  });
}

export function fetchGovernanceGlossaryTerm(termId, options = {}) {
  const template = contractPath("governanceGlossaryTerm") || "/governance/glossary/:id";
  return request(routeToken(template, "id", termId), { signal: options.signal }).then((payload) =>
    normalizeGlossaryTermPayload(payload),
  );
}

export function createGovernanceRequest(payload) {
  return requestJson("/governance/requests", "POST", payload);
}

export function upsertGovernanceOwner(payload) {
  return requestJson("/governance/owners", "POST", payload);
}

export function upsertGovernanceGlossaryTerm(payload) {
  return requestJson("/governance/glossary", "POST", payload);
}

export function updateGovernanceRequest(requestId, payload) {
  const template = contractPath("governanceRequest") || "/governance/requests/:id";
  return requestJson(routeToken(template, "id", requestId), "PATCH", payload);
}

export function updateGovernanceNotification(notificationId, payload) {
  const template = contractPath("governanceNotification") || "/governance/notifications/:id";
  return requestJson(routeToken(template, "id", notificationId), "PATCH", payload);
}

export function updateGovernanceGlossaryTerm(termId, payload) {
  const template = contractPath("governanceGlossaryTerm") || "/governance/glossary/:id";
  return requestJson(routeToken(template, "id", termId), "PATCH", payload);
}

export function updateAssetColumnDescription(assetFqn, columnName, description) {
  return requestJson(
    columnRoute("/assets/:fqn/columns/:column/description", assetFqn, columnName),
    "PATCH",
    { description },
  );
}

export function updateAssetColumnTags(assetFqn, columnName, tags) {
  return requestJson(
    columnRoute("/assets/:fqn/columns/:column/tags", assetFqn, columnName),
    "PATCH",
    { tags },
  );
}

export function updateAssetColumnMetadata(assetFqn, columnName, payload) {
  const template = contractPath("assetColumnMetadataUpdate") || "/assets/:fqn/columns/:column/metadata";
  return requestJson(
    columnRoute(template, assetFqn, columnName),
    "PATCH",
    payload,
  );
}

export function getAssetMetadataApiContract(assetFqn) {
  const capabilityTemplate = contractPath(
    "assetMetadataEditor",
    "assetMetadataEdit",
    "assetMetadata",
    "assetMetadataUpdate",
  );
  const updateTemplate = contractPath(
    "assetMetadataUpdate",
    "assetMetadataEditor",
    "assetMetadataEdit",
    "assetMetadata",
  );

  return {
    available: Boolean(capabilityTemplate || updateTemplate),
    capabilityPath: assetRoute(capabilityTemplate, assetFqn),
    updatePath: assetRoute(updateTemplate || capabilityTemplate, assetFqn),
  };
}

export async function fetchAssetMetadataEditor(assetFqn, endpoint) {
  const contract = getAssetMetadataApiContract(assetFqn);
  const path = endpoint || contract.capabilityPath;
  if (!path) return null;

  try {
    return await request(path);
  } catch (error) {
    if ([404, 405, 501].includes(error?.status)) {
      return null;
    }
    throw error;
  }
}

export async function updateAssetMetadata(assetFqn, payload, config = {}) {
  const contract = getAssetMetadataApiContract(assetFqn);
  const targetPath = assetRoute(
    config.updatePath || config.path || config.endpoint || contract.updatePath,
    assetFqn,
  );
  if (!targetPath) {
    throw new Error("Metadata editing is not available for this asset.");
  }

  const methods = [
    normalizedMethod(config.updateMethod, ""),
    normalizedMethod(config.method, ""),
    "PATCH",
    "POST",
    "PUT",
  ].filter(Boolean);
  const attempts = [...new Set(methods)];
  let lastError = null;

  for (const method of attempts) {
    try {
      return await requestJson(targetPath, method, payload);
    } catch (error) {
      if ([404, 405, 501].includes(error?.status)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("Metadata editing is not available for this asset.");
}
