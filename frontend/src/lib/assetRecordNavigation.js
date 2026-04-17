import {
  canOpenAssetRecord,
  prefetchAssetAvailability,
  prefetchAssetDetail,
} from "../hooks/useAssetDetail";

export async function openAssetRecordSafely(assetFqn, options = {}) {
  if (!assetFqn) return false;

  const {
    loadingLabel = "Opening metadata record…",
    sections = ["header", "activity"],
    canOpen = canOpenAssetRecord,
    onNavigationStateChange,
    onOpen,
    onUnavailable,
    beforeOpen,
  } = options;

  onNavigationStateChange?.(true, loadingLabel);

  try {
    const [availabilityMap, detail] = await Promise.all([
      prefetchAssetAvailability([assetFqn], { force: true }).catch(() => null),
      prefetchAssetDetail(assetFqn, {
        force: true,
        sections,
      }).catch(() => null),
    ]);
    const availability = availabilityMap?.[assetFqn] ?? null;

    if (!canOpen(detail, availability)) {
      onUnavailable?.({ assetFqn, availability, detail });
      onNavigationStateChange?.(false, "");
      return false;
    }

    beforeOpen?.({ assetFqn, availability, detail });
    onOpen?.(assetFqn, { availability, detail });
    return true;
  } catch (error) {
    onUnavailable?.({ assetFqn, availability: null, detail: null, error });
    onNavigationStateChange?.(false, "");
    return false;
  }
}
