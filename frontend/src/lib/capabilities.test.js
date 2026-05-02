import { describe, expect, it } from "vitest";
import { runtimeFeatureFlagAvailable, tableLineageAvailable } from "./capabilities";

describe("capability helpers", () => {
  it("does not treat unknown lineage capability state as openable", () => {
    expect(
      tableLineageAvailable({
        capabilities: {
          tableLineage: {
            available: true,
            state: "unknown",
          },
        },
      }),
    ).toBe(false);
  });

  it("does not treat unknown runtime feature flags as enabled", () => {
    expect(
      runtimeFeatureFlagAvailable(
        [
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "unknown",
          },
        ],
        "table_lineage_surface",
      ),
    ).toBe(false);
  });
});
