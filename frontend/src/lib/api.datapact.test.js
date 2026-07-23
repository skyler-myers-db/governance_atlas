import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchDataPactOverview,
  fetchDataPactRun,
  fetchDataPactRunLive,
  fetchDataPactStatus,
  pollDataPactGenie,
  startDataPactGenie,
  triggerDataPactRun,
} from "./api";

function captureFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({ ok: true }),
    text: async () => "{}",
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastCall(fetchMock) {
  const [url, options] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url: String(url), options: options || {} };
}

describe("DataPact API contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads status + overview via GET on the datapact routes", async () => {
    const fetchMock = captureFetch();
    await fetchDataPactStatus();
    expect(lastCall(fetchMock).url).toMatch(/\/api\/datapact\/status$/);
    expect((lastCall(fetchMock).options.method || "GET")).toBe("GET");

    await fetchDataPactOverview();
    expect(lastCall(fetchMock).url).toMatch(/\/api\/datapact\/overview$/);

    await fetchDataPactOverview({ refresh: true });
    expect(lastCall(fetchMock).url).toMatch(/\/api\/datapact\/overview\?refresh=1$/);
  });

  it("reads run detail + live status keyed by run id", async () => {
    const fetchMock = captureFetch();
    await fetchDataPactRun(987);
    expect(lastCall(fetchMock).url).toMatch(/\/api\/datapact\/runs\/987$/);
    await fetchDataPactRunLive(987);
    expect(lastCall(fetchMock).url).toMatch(/\/api\/datapact\/runs\/987\/live$/);
  });

  it("triggers a run via POST with an explicit confirm flag", async () => {
    const fetchMock = captureFetch();
    await triggerDataPactRun(55, { confirm: true, idempotencyToken: "tok" });
    const { url, options } = lastCall(fetchMock);
    expect(url).toMatch(/\/api\/datapact\/jobs\/55\/run$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ confirm: true, idempotencyToken: "tok" });
  });

  it("drives the Signal Room via genie start + poll POSTs", async () => {
    const fetchMock = captureFetch();
    await startDataPactGenie("How is trust trending?");
    let call = lastCall(fetchMock);
    expect(call.url).toMatch(/\/api\/datapact\/genie\/start$/);
    expect(call.options.method).toBe("POST");
    expect(JSON.parse(call.options.body)).toEqual({ question: "How is trust trending?" });

    await pollDataPactGenie("conv-1", "msg-1");
    call = lastCall(fetchMock);
    expect(call.url).toMatch(/\/api\/datapact\/genie\/poll$/);
    expect(JSON.parse(call.options.body)).toEqual({ conversationId: "conv-1", messageId: "msg-1" });
  });
});
