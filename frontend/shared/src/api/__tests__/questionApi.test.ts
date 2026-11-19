/* ==========================================================================
   题目列表请求的查询参数
   --------------------------------------------------------------------------
   重点是**标签 ID 怎么发**：服务端绑定 `long[]` 只认重复参数，
   逗号分隔会被判成非法值——按标签筛选的请求会整条 400。
   ========================================================================== */

import { describe, expect, it, vi } from "vitest";
import { loadQuestions, type QuestionClient } from "../questionApi";
import type { QueryValue } from "../httpClient";

/** 记录调用参数的假客户端。 */
function fakeClient() {
  const get = vi.fn(
    async (_path: string, _options?: { query?: Record<string, QueryValue> }) => ({
      items: [],
      total: 0,
    }),
  );
  const client = { get, post: vi.fn(), put: vi.fn(), delete: vi.fn() } as unknown as QuestionClient;
  return { client, get };
}

/** 取第一次调用带上的查询参数。 */
function firstQuery(get: ReturnType<typeof fakeClient>["get"]): Record<string, QueryValue> {
  return get.mock.calls[0]![1]?.query ?? {};
}

describe("questionApi · 题目列表查询参数", () => {
  it("标签 ID 按数组发出，不拼成逗号串", async () => {
    const { client, get } = fakeClient();

    await loadQuestions({ tagIds: ["8", "9"] }, client);

    const query = firstQuery(get);
    expect(query.tagIds).toEqual(["8", "9"]);
    expect(typeof query.tagIds).not.toBe("string");
  });

  it("把含子标签开关与命中模式交给服务端", async () => {
    const { client, get } = fakeClient();

    await loadQuestions(
      { tagIds: ["8"], includeDescendants: false, matchMode: "all" },
      client,
    );

    const query = firstQuery(get);
    expect(query.includeDescendants).toBe(false);
    expect(query.matchMode).toBe("all");
  });

  it("没给开关时不发这两个参数（用服务端默认值）", async () => {
    const { client, get } = fakeClient();

    await loadQuestions({ tagIds: ["8"] }, client);

    const query = firstQuery(get);
    expect(query.includeDescendants).toBeUndefined();
    expect(query.matchMode).toBeUndefined();
  });
});
