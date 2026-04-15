import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGovhubQueryClient } from "../lib/queryClient";
import { useGovernanceGlossaryTerm } from "./useGovernanceGlossaryTerm";

const fetchGovernanceGlossaryTermMock = vi.fn();

vi.mock("../lib/api", () => ({
  fetchGovernanceGlossaryTerm: (...args) => fetchGovernanceGlossaryTermMock(...args),
}));

function createWrapper() {
  const queryClient = createGovhubQueryClient();
  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useGovernanceGlossaryTerm", () => {
  beforeEach(() => {
    fetchGovernanceGlossaryTermMock.mockReset();
  });

  it("loads a glossary term through an abortable query", async () => {
    fetchGovernanceGlossaryTermMock.mockResolvedValue({
      termId: "term-1",
      term: "Customer Identifier",
      definition: "Customer grain identifier",
    });

    const { result } = renderHook(() => useGovernanceGlossaryTerm("term-1"), {
      wrapper: createWrapper(),
    });

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(fetchGovernanceGlossaryTermMock).toHaveBeenCalledTimes(1);
      expect(result.current.loading).toBe(false);
      expect(result.current.term?.termId).toBe("term-1");
    });

    expect(fetchGovernanceGlossaryTermMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the seeded glossary term while refresh happens in the background", async () => {
    fetchGovernanceGlossaryTermMock.mockResolvedValue({
      termId: "term-1",
      term: "Customer Identifier",
      definition: "Customer grain identifier",
    });

    const seedTerm = {
      termId: "term-1",
      term: "Customer Identifier",
      definition: "Seeded detail",
    };

    const { result } = renderHook(
      () => useGovernanceGlossaryTerm("term-1", { seedTerm }),
      {
        wrapper: createWrapper(),
      },
    );

    expect(result.current.term?.definition).toBe("Seeded detail");
    expect(result.current.loading).toBe(false);

    await waitFor(() => {
      expect(result.current.term?.definition).toBe("Customer grain identifier");
    });
  });

  it("stays idle when no term is selected", () => {
    const { result } = renderHook(() => useGovernanceGlossaryTerm(""), {
      wrapper: createWrapper(),
    });

    expect(fetchGovernanceGlossaryTermMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.term).toBeNull();
  });
});
