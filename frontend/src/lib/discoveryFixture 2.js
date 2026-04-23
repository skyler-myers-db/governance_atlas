/**
 * Deterministic "target-mockup" fixture for identity / QA runs.
 *
 * When the URL carries `?fixture=target-mockup`, Discovery wraps each
 * asset with synthetic golden-state metadata (domain, owners, tags,
 * coverage score, workflow state) so the UI renders identically in
 * CI, dev, and the deployed preview environment regardless of what
 * the backend catalog looks like today.
 *
 * This is test/showcase wiring, not a production feature. The flag
 * is explicit and opt-in. Without the flag, behavior is unchanged.
 */

// Realistic synthetic stewards for fixture mode. Intentionally chosen so they
// do not echo the original mockup's placeholder labels ("Namer Avatar",
// "Anner Avatar") — the user explicitly flagged those as mockup artifacts
// that must never leak into the product surface, even in fixture mode.
const GOLDEN_OWNER_SEED = [
  { name: "Priya Subramaniam", email: "priya.subramaniam@example.org" },
  { name: "Marcus Chen", email: "marcus.chen@example.org" },
  { name: "Elena Vasquez", email: "elena.vasquez@example.org" },
];

const GOLDEN_TAGS = ["PII", "Transaction", "Critical"];
const GOLDEN_DOMAIN = "Finance";
const GOLDEN_WORKFLOW = "Certified";
const GOLDEN_COVERAGE = 92;

export function isFixtureMode(search = "") {
  if (typeof search !== "string") return false;
  try {
    return new URLSearchParams(search).get("fixture") === "target-mockup";
  } catch {
    return false;
  }
}

export function applyTargetMockupFixture(asset, index = 0) {
  if (!asset) return asset;
  const owner = GOLDEN_OWNER_SEED[index % GOLDEN_OWNER_SEED.length];
  return {
    ...asset,
    domain: asset.domain && asset.domain !== "Unassigned" ? asset.domain : GOLDEN_DOMAIN,
    owners: asset.owners?.length ? asset.owners : [owner],
    tagEntries:
      asset.tagEntries?.length
        ? asset.tagEntries
        : GOLDEN_TAGS.map((label) => ({ label })),
    tags: asset.tags?.length ? asset.tags : GOLDEN_TAGS,
    governanceStatus: asset.governanceStatus || GOLDEN_WORKFLOW,
    coverageScore:
      Number.isFinite(Number(asset.coverageScore)) && Number(asset.coverageScore) >= 50
        ? asset.coverageScore
        : GOLDEN_COVERAGE,
    usage: {
      ...(asset.usage || {}),
      views: asset.usage?.views ?? 2,
      notebooks: asset.usage?.notebooks ?? 2,
    },
    notebookUsage: asset.notebookUsage ?? 2,
    viewCount: asset.viewCount ?? 2,
  };
}

export function applyTargetMockupFixtureToAll(assets = []) {
  if (!Array.isArray(assets)) return assets;
  return assets.map((asset, index) => applyTargetMockupFixture(asset, index));
}
