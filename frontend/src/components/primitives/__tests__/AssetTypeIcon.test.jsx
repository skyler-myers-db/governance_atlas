import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssetTypeIcon } from "../AssetTypeIcon.jsx";

describe("AssetTypeIcon", () => {
  it("renders with aria-label derived from the resolved type", () => {
    const { container } = render(<AssetTypeIcon type="Delta Table" />);
    const icon = container.querySelector('.gh-asset-type-icon');
    expect(icon?.getAttribute("aria-label")).toBe("Delta Table");
  });

  it("falls back to 'Asset' when type cannot be resolved", () => {
    const { container } = render(<AssetTypeIcon asset={{ objectType: "" }} />);
    const icon = container.querySelector('.gh-asset-type-icon');
    expect(icon?.getAttribute("aria-label")).toBe("Asset");
  });

  it("sizes the glyph based on the size prop", () => {
    const { container: small } = render(
      <AssetTypeIcon type="Streaming Table" size="sm" />,
    );
    const { container: large } = render(
      <AssetTypeIcon type="Streaming Table" size="xl" />,
    );
    const smallEl = small.querySelector(".gh-asset-type-icon");
    const largeEl = large.querySelector(".gh-asset-type-icon");
    expect(smallEl?.style.width).toBe("16px");
    expect(largeEl?.style.width).toBe("40px");
  });

  it("resolves the type via displayObjectType when an asset is passed", () => {
    const { container } = render(
      <AssetTypeIcon asset={{ tableTypeRaw: "MATERIALIZED_VIEW" }} />,
    );
    const icon = container.querySelector(".gh-asset-type-icon");
    expect(icon?.getAttribute("aria-label")).toBe("Materialized View");
  });

  it("applies a family-specific background color per type", () => {
    const { container: view } = render(<AssetTypeIcon type="View" />);
    const { container: streaming } = render(<AssetTypeIcon type="Streaming Table" />);
    const viewEl = view.querySelector(".gh-asset-type-icon");
    const streamingEl = streaming.querySelector(".gh-asset-type-icon");
    expect(viewEl?.style.background).not.toBe(streamingEl?.style.background);
  });
});
