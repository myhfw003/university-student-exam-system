/* ==========================================================================
   HTTP 客户端的查询参数拼装
   --------------------------------------------------------------------------
   重点是**数组参数怎么发**：服务端的 `long[]` 只认重复参数
   （`tagIds=1&tagIds=2`），逗号分隔（`tagIds=1,2`）会被判成非法值。
   拼错这一处，按标签筛选的请求就整条 400。
   ========================================================================== */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../httpClient";

/** 抓下来的请求地址。 */
function captureUrl(): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return { urls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("httpClient · 查询参数", () => {
  it("数组参数按重复参数发出", async () => {
    const { urls } = captureUrl();
    const client = createHttpClient({ baseUrl: "/api/v1", getAuthToken: () => null });

    await client.get("/questions", { query: { tagIds: ["8", "9"] } });

    expect(urls[0]).toBe("/api/v1/questions?tagIds=8&tagIds=9");
  });

  it("数组与其它参数混排时都带上", async () => {
    const { urls } = captureUrl();
    const client = createHttpClient({ baseUrl: "/api/v1", getAuthToken: () => null });

    await client.get("/questions", {
      query: { tagIds: ["8", "9"], page: 1, includeDescendants: true },
    });

    expect(urls[0]).toContain("tagIds=8");
    expect(urls[0]).toContain("tagIds=9");
    expect(urls[0]).toContain("page=1");
    expect(urls[0]).toContain("includeDescendants=true");
  });

  it("空值不发给服务端", async () => {
    const { urls } = captureUrl();
    const client = createHttpClient({ baseUrl: "/api/v1", getAuthToken: () => null });

    await client.get("/questions", { query: { tagIds: [], keyword: undefined, bankId: null } });

    expect(urls[0]).toBe("/api/v1/questions");
  });
});
