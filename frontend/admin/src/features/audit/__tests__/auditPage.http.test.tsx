/* ==========================================================================
   管理端审计页 · HTTP 模式
   --------------------------------------------------------------------------
   断言的是页面上能看到的东西：日志条目、动作中文名，
   以及「动作与对象类型交给服务端、操作者与关键词在前端筛」这条口径。
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/** 被测的 API 函数。 */
const api = {
  loadAuditLogs: vi.fn(),
};

vi.mock("@exam/shared/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBackendEnabled: () => true,
  ...api,
}));

const { AuditLogPage } = await import("../AuditLogPage");

/** 后端审计日志。 */
const LOGS = {
  items: [
    {
      id: "997",
      at: "2026-11-18T08:06:17Z",
      operatorId: "1",
      operator: "admin",
      action: "user.import-roster",
      targetType: "user",
      targetId: "",
      summary: '{"total": 2, "created": 1}',
      ip: "127.0.0.1",
      userAgent: "Chrome 131",
    },
    {
      id: "996",
      at: "2026-11-18T08:05:00Z",
      operatorId: "2",
      operator: "陈砚之",
      action: "user.role_changed",
      targetType: "user",
      targetId: "32",
      summary: "为「林知遥」调整角色",
      ip: "10.12.0.21",
      userAgent: "Chrome 131",
    },
  ],
  total: 2,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="*" element={<AuditLogPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("管理端审计页 · HTTP 模式", () => {
  beforeEach(() => {
    api.loadAuditLogs.mockReset();
    api.loadAuditLogs.mockResolvedValue(LOGS);
  });

  it("显示服务端返回的日志与动作名", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("为「林知遥」调整角色")).toBeInTheDocument();
    });

    // 登记过的动作给中文名（筛选项与徽标上都有）。
    expect(screen.getAllByText("变更角色").length).toBeGreaterThan(0);
    // 没登记过的动作原样显示动作码，不能显示成空白。
    expect(screen.getByText("user.import-roster")).toBeInTheDocument();
    // IP 与 UA 在同一个单元格里（中间有换行），按文本片段找。
    expect(screen.getByText(/10\.12\.0\.21/)).toBeInTheDocument();
  });

  it("动作筛选交给服务端", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(api.loadAuditLogs).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "变更角色" }));

    await waitFor(() => {
      const last = api.loadAuditLogs.mock.calls.at(-1)![0];
      expect(last.action).toBe("user.role_changed");
    });
  });

  it("操作者筛选在前端这一页里筛", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("为「林知遥」调整角色")).toBeInTheDocument();
    });

    // 选「admin」之后只剩它自己那一行，陈砚之的那行被筛掉。
    await user.click(screen.getByRole("button", { name: "admin" }));

    await waitFor(() => {
      expect(screen.queryByText("为「林知遥」调整角色")).not.toBeInTheDocument();
    });
    expect(screen.getByText("user.import-roster")).toBeInTheDocument();
    // 服务端请求参数里没有操作者——后端按 ID 筛，页面上选的是名字。
    const last = api.loadAuditLogs.mock.calls.at(-1)![0];
    expect(last.operatorId).toBeUndefined();
  });
});

/** 后端写下的登录审计（FR-AUD-01）。 */
const LOGIN_LOGS = {
  items: [
    {
      id: "1201",
      at: "2026-11-19T09:12:03Z",
      operatorId: "7",
      operator: "zhangsan",
      action: "auth.login",
      targetType: "user",
      targetId: "7",
      summary: '{"username": "zhangsan"}',
      ip: "10.12.0.21",
      userAgent: "Chrome 131",
    },
    {
      id: "1200",
      at: "2026-11-19T09:10:41Z",
      operatorId: "8",
      operator: "ghost",
      action: "auth.login_failed",
      targetType: "user",
      targetId: "ghost",
      summary: '{"username": "ghost", "reason": "账号不存在"}',
      ip: "10.12.0.44",
      userAgent: "Chrome 131",
    },
    {
      id: "1199",
      at: "2026-11-19T09:09:12Z",
      operatorId: "9",
      operator: "zhangsan",
      action: "auth.refresh_reuse",
      targetType: "user",
      targetId: "9",
      summary: '{"reason": "刷新令牌被重复使用"}',
      ip: "10.12.0.21",
      userAgent: "Chrome 131",
    },
    {
      id: "1198",
      at: "2026-11-19T08:58:02Z",
      operatorId: "9",
      operator: "zhangsan",
      action: "auth.logout",
      targetType: "user",
      targetId: "9",
      summary: '{"username": "zhangsan", "refreshTokenRevoked": true}',
      ip: "10.12.0.21",
      userAgent: "Chrome 131",
    },
  ],
  total: 4,
};

describe("管理端审计页 · 登录审计", () => {
  beforeEach(() => {
    api.loadAuditLogs.mockReset();
    api.loadAuditLogs.mockResolvedValue(LOGIN_LOGS);
  });

  it("显示后端写下的登录成功与登录失败", async () => {
    renderPage();

    // 动作中文名：徽标与筛选项上都有。
    await waitFor(() => {
      expect(screen.getAllByText("登录成功").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("登录失败").length).toBeGreaterThan(0);
    // 刷新令牌被重复使用也有登记（FR-IAM-02）。
    expect(screen.getAllByText("刷新令牌异常使用").length).toBeGreaterThan(0);
    // 登出也留痕。
    expect(screen.getAllByText("登出").length).toBeGreaterThan(0);
    // 操作者列上是登录账号（失败那次是自称的账号）。
    expect(screen.getAllByText("zhangsan").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ghost").length).toBeGreaterThan(0);
    // 失败原因在摘要里。
    expect(screen.getByText(/账号不存在/)).toBeInTheDocument();
  });

  it("按登录动作筛选时把动作码交给服务端", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(api.loadAuditLogs).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "登录失败" }));

    await waitFor(() => {
      const last = api.loadAuditLogs.mock.calls.at(-1)![0];
      expect(last.action).toBe("auth.login_failed");
    });
  });
});
