/* ==========================================================================
   管理端系统设置页 · HTTP 模式
   --------------------------------------------------------------------------
   断言的是**页面看到的是服务端的值**与**保存时发出去的请求**：
   值由后端给（前端不另立一套），保存走 `PUT /settings`。
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useToastStore } from "@exam/shared";
import { MISTAKE_RESOLUTION_POLICY } from "@exam/shared/domain/settings";

/**
 * 被测的 API 函数。
 *
 * 用 `vi.hoisted` 声明：`vi.mock` 会被提升到文件顶部，
 * 而本文件在 mock 之前就 import 了 `@exam/shared`（它会带出 api 模块），
 * mock 工厂执行时 `api` 还没初始化——直接写 `const api = {...}` 会炸。
 */
const api = vi.hoisted(() => ({
  loadSystemSettings: vi.fn(),
  updateSystemSettings: vi.fn(),
  setOriginalPassword: vi.fn(),
  clearOriginalPassword: vi.fn(),
}));

vi.mock("@exam/shared/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBackendEnabled: () => true,
  ...api,
}));

const { SettingsPage } = await import("../SettingsPage");

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** 最近一条提示条文案。 */
function lastToast(): string | undefined {
  const toasts = useToastStore.getState().toasts;
  return toasts[toasts.length - 1]?.message;
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  useToastStore.setState({ toasts: [] });
  api.loadSystemSettings.mockResolvedValue({
    mistakeResolutionPolicy: MISTAKE_RESOLUTION_POLICY.keepMastered,
    updatedAt: "2026-11-21T02:00:00Z",
    updatedBy: "7",
  });
  api.updateSystemSettings.mockResolvedValue({
    mistakeResolutionPolicy: MISTAKE_RESOLUTION_POLICY.remove,
    updatedAt: "2026-11-21T03:00:00Z",
    updatedBy: "7",
  });
  api.setOriginalPassword.mockResolvedValue({
    mistakeResolutionPolicy: MISTAKE_RESOLUTION_POLICY.keepMastered,
    originalPasswordConfigured: true,
    updatedAt: null,
    updatedBy: null,
  });
  api.clearOriginalPassword.mockResolvedValue({
    mistakeResolutionPolicy: MISTAKE_RESOLUTION_POLICY.keepMastered,
    originalPasswordConfigured: false,
    updatedAt: null,
    updatedBy: null,
  });
});

describe("管理端系统设置页 · HTTP 模式", () => {
  it("显示服务端给的口径与最后修改时间", async () => {
    renderPage();

    await waitFor(() => expect(api.loadSystemSettings).toHaveBeenCalled());

    // 值由后端给：前端不拿缺省值覆盖它。
    // 要等状态落定——接口被调用不等于值已经填进页面。
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保留但标记已掌握" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByText(/最后修改：/)).toBeInTheDocument();
  });

  it("保存时把选中的口径发给服务端", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保留但标记已掌握" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    await user.click(screen.getByRole("button", { name: "移出错题本" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.updateSystemSettings).toHaveBeenCalledWith(
        MISTAKE_RESOLUTION_POLICY.remove,
      ),
    );
    expect(lastToast()).toBe("系统设置已保存，立即生效");
  });

  it("原始密码的状态由服务端给", async () => {
    api.loadSystemSettings.mockResolvedValue({
      mistakeResolutionPolicy: MISTAKE_RESOLUTION_POLICY.keepMastered,
      originalPasswordConfigured: true,
      updatedAt: "2026-11-21T02:00:00Z",
      updatedBy: "7",
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("已配置")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "清除原始密码" })).toBeInTheDocument();
  });

  it("设置原始密码时把密码发给服务端", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(api.loadSystemSettings).toHaveBeenCalled());

    await user.type(screen.getByLabelText("原始密码"), "OrigPass123");
    await user.click(screen.getByRole("button", { name: "设置原始密码" }));

    await waitFor(() => expect(api.setOriginalPassword).toHaveBeenCalledWith("OrigPass123"));
    expect(lastToast()).toBe("原始密码已设置。重置用户密码时会置成它。");
  });

  it("服务端拒绝时把说法原样带出来", async () => {
    api.updateSystemSettings.mockRejectedValue(new Error("错题处理口径不合法。"));

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保留但标记已掌握" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    await user.click(screen.getByRole("button", { name: "移出错题本" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(lastToast()).toBe("错题处理口径不合法。"));
  });
});
