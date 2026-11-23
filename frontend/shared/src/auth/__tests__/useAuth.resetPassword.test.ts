/* ==========================================================================
   管理员重置密码（HTTP 模式）
   --------------------------------------------------------------------------
   重置密码**不带密码**：密码由后端取系统设定的原始密码，
   请求里再传一遍密码就等于把密码多送了一程——这条断言就是守住这一点。

   响应里也没有密码：管理员自己配的原始密码，由管理员另行告知用户。
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

const mode = vi.hoisted(() => ({ value: "http" as "mock" | "http" }));

vi.mock("../../api/httpClient", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  httpClient: http,
}));

vi.mock("../../api/dataSource", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  dataSourceMode: () => mode.value,
}));

const { useAuth } = await import("../useAuth");

describe("管理员重置密码 · HTTP 模式", () => {
  beforeEach(() => {
    mode.value = "http";
    for (const fn of Object.values(http)) fn.mockReset();
    http.post.mockResolvedValue({ userId: "32" });
    useAuth.setState({ status: "authenticated", user: null, mode: "http" });
  });

  it("请求里不带密码：密码由后端取系统设定的原始密码", async () => {
    const result = await useAuth.getState().resetPassword("32");

    expect(result.ok).toBe(true);
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith("/users/32/reset-password");
    // 只有一个参数：没有密码。
    expect(http.post.mock.calls[0]!.length).toBe(1);
  });

  it("没配原始密码时把后端的说法原样带出来", async () => {
    http.post.mockRejectedValue(
      new Error("尚未配置原始密码，无法重置密码。请先在「系统设置」中配置原始密码。"),
    );

    const result = await useAuth.getState().resetPassword("32");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("尚未配置原始密码");
  });
});
