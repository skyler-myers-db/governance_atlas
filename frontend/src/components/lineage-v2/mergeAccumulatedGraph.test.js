import { describe, expect, it } from "vitest";
import { mergeAccumulatedGraph } from "./mergeAccumulatedGraph";

const focusA = { id: "focus-a.b.c", fqn: "a.b.c", isFocus: true, role: "focus" };
const targetD = { id: "target-a.b.d", fqn: "a.b.d", isFocus: false, role: "peer" };
const edgeAD = { id: "e1", source: "focus-a.b.c", target: "target-a.b.d", kind: "" };

describe("mergeAccumulatedGraph", () => {
  it("resets when the incoming focus is a brand-new asset", () => {
    const current = mergeAccumulatedGraph(
      { nodes: [], edges: [] },
      { nodes: [focusA, targetD], edges: [edgeAD], focus: focusA },
    );
    const unrelatedFocus = { id: "focus-x.y.z", fqn: "x.y.z", isFocus: true, role: "focus" };
    const next = mergeAccumulatedGraph(current, {
      nodes: [unrelatedFocus],
      edges: [],
      focus: unrelatedFocus,
    });
    expect(next.isExpand).toBe(false);
    expect(next.nodes.map((n) => n.fqn)).toEqual(["x.y.z"]);
  });

  it("expands when the clicked neighbor comes back as the new focus (role-prefixed id changes)", () => {
    const current = mergeAccumulatedGraph(
      { nodes: [], edges: [] },
      { nodes: [focusA, targetD], edges: [edgeAD], focus: focusA },
    );
    // User clicked a.b.d; it returns as focus-a.b.d with its own neighbor a.b.e.
    const newFocusD = { id: "focus-a.b.d", fqn: "a.b.d", isFocus: true, role: "focus" };
    const targetE = { id: "target-a.b.e", fqn: "a.b.e", isFocus: false, role: "peer" };
    const edgeDE = { id: "e2", source: "focus-a.b.d", target: "target-a.b.e", kind: "" };
    const next = mergeAccumulatedGraph(current, {
      nodes: [newFocusD, targetE],
      edges: [edgeDE],
      focus: newFocusD,
    });
    expect(next.isExpand).toBe(true);
    // a.b.c (from before), a.b.d (deduped, now focus), a.b.e (new) — no duplicate a.b.d.
    expect(new Set(next.nodes.map((n) => n.fqn))).toEqual(new Set(["a.b.c", "a.b.d", "a.b.e"]));
    expect(next.nodes.filter((n) => n.fqn === "a.b.d")).toHaveLength(1);
  });

  it("prefers the focus-role copy of a duplicated asset", () => {
    const current = mergeAccumulatedGraph(
      { nodes: [], edges: [] },
      { nodes: [focusA, targetD], edges: [edgeAD], focus: focusA },
    );
    const newFocusD = { id: "focus-a.b.d", fqn: "a.b.d", isFocus: true, role: "focus" };
    const next = mergeAccumulatedGraph(current, {
      nodes: [newFocusD],
      edges: [],
      focus: newFocusD,
    });
    const dNode = next.nodes.find((n) => n.fqn === "a.b.d");
    expect(dNode.isFocus).toBe(true);
    expect(dNode.id).toBe("focus-a.b.d");
  });

  it("remaps edge endpoints onto canonical per-FQN ids so links survive a role change", () => {
    const current = mergeAccumulatedGraph(
      { nodes: [], edges: [] },
      { nodes: [focusA, targetD], edges: [edgeAD], focus: focusA },
    );
    const newFocusD = { id: "focus-a.b.d", fqn: "a.b.d", isFocus: true, role: "focus" };
    const next = mergeAccumulatedGraph(current, {
      nodes: [newFocusD],
      edges: [],
      focus: newFocusD,
    });
    // The old edge referenced target-a.b.d; a.b.d is now focus-a.b.d.
    const edge = next.edges.find((e) => e.source === "focus-a.b.c");
    expect(edge.target).toBe("focus-a.b.d");
  });

  it("falls back to id keying when a node has no fqn", () => {
    const bare = { id: "n1", isFocus: true, role: "focus" };
    const result = mergeAccumulatedGraph(
      { nodes: [], edges: [] },
      { nodes: [bare], edges: [], focus: bare },
    );
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe("n1");
  });
});
