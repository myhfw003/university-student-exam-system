/* ==========================================================================
   刷新令牌的单飞
   --------------------------------------------------------------------------
   刷新令牌是**一次性**的：同一个 Cookie 并发刷新两次，后一次会被后端判成
   盗用并**整族吊销**——连前一次刚换发的新令牌一起废掉，会话当场死掉。

   并发刷新很容易发生：页面加载时「引导登录态的刷新」与「某个请求 401
   触发的刷新」会同时发出。所以刷新必须**单飞**：并发调用共用一次请求。
   ========================================================================== */

import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshAccessToken } from "../authRefresh";
import { clearTokens, getAccessToken } from "../tokenStore";

/** 造一个最小可用的 JSON 响应。 */
function json(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  // 令牌存储是模块级变量，测试之间要清干净。
  clearTokens();
});

describe("refreshAccessToken · 刷新令牌", () => {
  it("并发调用只发一次请求", async () => {
    const fetchMock = vi.fn(async () => json({ accessToken: "new-token", expiresIn: 900 }));
    vi.stubGlobal("fetch", fetchMock);

    const [a, b, c] = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ]);

    // 只发一次：并发刷新会被后端判成盗用、整族吊销。
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(a?.accessToken).toBe("new-token");
    expect(b?.accessToken).toBe("new-token");
    expect(c?.accessToken).toBe("new-token");

    // 换发来的令牌要落到令牌存储里。
    expect(getAccessToken()).toBe("new-token");
  });

  it("刷新失败时不留下令牌", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 422,
      text: async () => "",
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it("一次失败之后还能再试（单飞不会把失败缓存住）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({}) } as unknown as Response)
      .mockResolvedValue(json({ accessToken: "second-token" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await refreshAccessToken()).toBeNull();
    expect((await refreshAccessToken())?.accessToken).toBe("second-token");
    expect(fetchMock.mock.calls.length).toBe(2);
  });
});
