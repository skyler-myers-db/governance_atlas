import { describe, expect, it } from "vitest";
import { catalogExplorerGate, certifyGate, lineageGate, requestChangeGate } from "../gates";

describe("lineageGate — trust the live per-asset response, never bootstrap", () => {
  it("is enabled with a live graph and reports the node count", () => {
    const gate = lineageGate({ nodes: [{ id: "a" }, { id: "b" }], error: "" });
    expect(gate.enabled).toBe(true);
    expect(gate.label).toBe("Open lineage");
    expect(gate.reason).toContain("2 assets");
  });

  it("stays ENABLED even when the live request failed (destination surfaces the truth)", () => {
    const gate = lineageGate({ nodes: [], error: "boom" });
    expect(gate.enabled).toBe(true);
  });

  it("stays enabled while loading and with an honest empty reason", () => {
    expect(lineageGate({ nodes: [], loading: true }).enabled).toBe(true);
    const empty = lineageGate({ nodes: [], meta: { emptyReason: "no-lineage-rows" } });
    expect(empty.enabled).toBe(true);
    expect(empty.reason).toContain("no-lineage-rows");
  });
});

describe("certifyGate", () => {
  it("writes through the metadata path when the live contract allows", () => {
    expect(certifyGate({ available: true }).mode).toBe("write");
  });

  it("stages a change request (with reason) when it does not", () => {
    const gate = certifyGate({ available: false });
    expect(gate.mode).toBe("stage");
    expect(gate.reason).toContain("change request");
  });
});

describe("catalogExplorerGate", () => {
  it("passes through the live deep link", () => {
    const gate = catalogExplorerGate({ deepLinks: { catalogExplorer: "/explore/data/c/s/t" } });
    expect(gate).toEqual({ enabled: true, href: "/explore/data/c/s/t", reason: "" });
  });

  it("disables with an honest reason while loading or absent", () => {
    expect(catalogExplorerGate({ state: "loading" }).reason).toContain("still loading");
    expect(catalogExplorerGate(null).enabled).toBe(false);
  });
});

describe("requestChangeGate", () => {
  it("requires only a real asset identity", () => {
    expect(requestChangeGate("c.s.t").enabled).toBe(true);
    expect(requestChangeGate("").enabled).toBe(false);
  });
});
