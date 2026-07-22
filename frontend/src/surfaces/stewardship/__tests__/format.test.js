import { describe, expect, it } from "vitest";
import {
  humanMutationError,
  isValidationWorkItem,
  lensCounts,
  matchesItemParam,
  matchesLens,
  normalizeWorkItem,
  patchWorkbenchRequests,
  scopeSummary,
  termReviewItem,
  workItemDisplayId,
} from "../format.js";

describe("stewardship format helpers", () => {
  it("compresses long store ids to GOV-XXXXXXXX and keeps short ids verbatim", () => {
    expect(workItemDisplayId({ requestId: "SI-2491" })).toBe("SI-2491");
    expect(workItemDisplayId({ requestId: "9f8e7d6c-5b4a-3921-8076-54efab321098" })).toBe(
      "GOV-9F8E7D6C",
    );
    expect(workItemDisplayId({ requestId: "ga-home-evidence-request-09" })).toBe("GOV-09");
  });

  it("matches ?item= params against display AND full ids, case-insensitively", () => {
    const item = { requestId: "9f8e7d6c-5b4a-3921-8076-54efab321098" };
    expect(matchesItemParam(item, "gov-9f8e7d6c")).toBe(true);
    expect(matchesItemParam(item, "9f8e7d6c-5b4a-3921-8076-54efab321098")).toBe(true);
    expect(matchesItemParam(item, "GOV-00000000")).toBe(false);
    expect(matchesItemParam(item, "")).toBe(false);
  });

  it("keeps lens semantics honest: term reviews never match p1/overdue", () => {
    const term = termReviewItem({ termId: "t-1", term: "Average Revenue", status: "Proposed" });
    expect(matchesLens(term, "p1", {})).toBe(false);
    expect(matchesLens(term, "overdue", {})).toBe(false);
    expect(matchesLens(term, "all", {})).toBe(true);
  });

  it("counts the my-work lens from real assignment fields only (no requester fallback)", () => {
    const user = { email: "skyler@entrada.ai", name: "Skyler Myers" };
    const assigned = normalizeWorkItem({ requestId: "r1", assigned: "Skyler Myers" });
    const requesterOnly = normalizeWorkItem({ requestId: "r2", requester: "Skyler Myers" });
    const counts = lensCounts([assigned, requesterOnly], user);
    expect(counts.mine).toBe(1);
    expect(counts.all).toBe(2);
  });

  it("rejects validation-seed rows", () => {
    expect(isValidationWorkItem({ requestId: "ga-home-seed-request-9" })).toBe(true);
    expect(isValidationWorkItem({ requestId: "SI-2491", source: "governance-store" })).toBe(false);
  });

  it("patches a request inside both workbench payload shapes without mutating", () => {
    const bare = { requests: [{ requestId: "r1", status: "Pending" }] };
    const patchedBare = patchWorkbenchRequests(bare, "r1", { status: "Resolved" });
    expect(patchedBare.requests[0].status).toBe("Resolved");
    expect(bare.requests[0].status).toBe("Pending");

    const enveloped = { data: { requests: [{ requestId: "r1", status: "Pending" }] } };
    const patchedEnv = patchWorkbenchRequests(enveloped, "r1", { status: "Resolved" });
    expect(patchedEnv.data.requests[0].status).toBe("Resolved");
    expect(enveloped.data.requests[0].status).toBe("Pending");
  });

  it("summarizes the openRequestScope split", () => {
    expect(
      scopeSummary({ visibleOpenCount: 1, outOfScopeOpenCount: 2, caption: "2 outside" }),
    ).toBe("1 in the visible estate · 2 on out-of-scope assets (2 outside)");
    expect(scopeSummary(null)).toBe("");
  });

  it("humanizes mutation failures and keeps the request id, never raw exception text", () => {
    const error = Object.assign(new Error("TypeError: boom"), {
      status: 500,
      detailMessage: "TypeError: boom",
      httpRequestId: "req-1",
    });
    expect(humanMutationError(error, "Couldn't update the work item.")).toBe(
      "Couldn't update the work item. (Request ID: req-1)",
    );
    const validation = Object.assign(new Error("nope"), {
      status: 403,
      detailMessage: "Steward role required.",
    });
    expect(humanMutationError(validation, "fallback")).toBe("Steward role required.");
  });
});
