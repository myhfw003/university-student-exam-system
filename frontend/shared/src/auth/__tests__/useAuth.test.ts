/* ==========================================================================
   mock 模式登录留痕（FR-AUD-01）
   --------------------------------------------------------------------------
   http 模式的登录审计由后端写；mock 模式没有后端，
   前端要补上同一行，否则审计页在 mock 下看不到这次登录。
   ========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";
import { useAuth } from "../useAuth";
import { useAdminOps } from "../../mock/adminOps";

describe("mock 模式登录留痕", () => {
  beforeEach(() => {
    useAdminOps.setState({ auditLogs: [] });
    useAuth.setState({ status: "anonymous", user: null });
  });

  it("登录成功写一条登录审计", async () => {
    const result = await useAuth.getState().signIn("zhangsan", "whatever", {
      id: "u-01",
      account: "zhangsan",
      name: "张三",
      roles: ["student"],
      orgTags: [],
    });

    expect(result.ok).toBe(true);

    const row = useAdminOps.getState().auditLogs[0];
    expect(row?.action).toBe("auth.login");
    expect(row?.operator).toBe("张三");
    expect(row?.targetType).toBe("user");
    expect(row?.targetId).toBe("u-01");
  });

  it("登出写一条登出审计", async () => {
    await useAuth.getState().signIn("zhangsan", "whatever", {
      id: "u-01",
      account: "zhangsan",
      name: "张三",
      roles: ["student"],
      orgTags: [],
    });
    useAdminOps.setState({ auditLogs: [] });

    useAuth.getState().signOut();

    const row = useAdminOps.getState().auditLogs[0];
    expect(row?.action).toBe("auth.logout");
    expect(row?.operator).toBe("张三");
    expect(row?.targetId).toBe("u-01");
  });

  it("登录失败也写一条失败审计", async () => {
    const result = await useAuth.getState().signIn("ghost", "wrong", null);

    expect(result.ok).toBe(false);

    const row = useAdminOps.getState().auditLogs[0];
    expect(row?.action).toBe("auth.login_failed");
    // 登不进去的时候只知道自称的账号。
    expect(row?.operator).toBe("ghost");
    expect(row?.targetId).toBe("ghost");
  });
});
