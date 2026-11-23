/* ==========================================================================
   管理端系统设置页 · mock 模式
   --------------------------------------------------------------------------
   断言的是**页面上真正能看到的东西**与**改完的结果**：
   两档口径、缺省档、以及改完立即生效（mock store 里已经是新值）。
   ========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useToastStore } from "@exam/shared";
import { MISTAKE_RESOLUTION_POLICY } from "@exam/shared/domain/settings";
import { resetMockSettings, useMockSettings } from "@exam/shared/mock/settings";
import { SettingsPage } from "../SettingsPage";

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
  resetMockSettings();
  useToastStore.setState({ toasts: [] });
});

describe("管理端系统设置页", () => {
  it("渲染两档口径，缺省是移出错题本", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "系统设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移出错题本" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保留但标记已掌握" })).toBeInTheDocument();

    // 缺省档是选中态，且说明写的是这一档的效果。
    expect(screen.getByRole("button", { name: "移出错题本" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByText("重做正确的题目会移出错题本：「只看未掌握」与「含已掌握」里都看不到它。"),
    ).toBeInTheDocument();
  });

  it("没改动时保存按钮不可用", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("改口径后保存，立即生效", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "保留但标记已掌握" }));

    // 说明跟着切换到新档。
    expect(
      screen.getByText("重做正确的题目留在错题本里，标成「已掌握」，在「含已掌握」筛选下能看到。"),
    ).toBeInTheDocument();

    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeEnabled();

    await user.click(save);

    expect(lastToast()).toBe("系统设置已保存，立即生效");
    expect(useMockSettings.getState().settings.mistakeResolutionPolicy).toBe(
      MISTAKE_RESOLUTION_POLICY.keepMastered,
    );
  });

  it("原始密码：没配时显示未配置，配好后显示已配置", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText("未配置")).toBeInTheDocument();
    // 没配的时候没有「清除」可点。
    expect(screen.queryByRole("button", { name: "清除原始密码" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("原始密码"), "OrigPass123");
    await user.click(screen.getByRole("button", { name: "设置原始密码" }));

    expect(lastToast()).toBe("原始密码已设置。重置用户密码时会置成它。");
    expect(useMockSettings.getState().settings.originalPasswordConfigured).toBe(true);

    await waitFor(() => expect(screen.getByText("已配置")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "清除原始密码" })).toBeInTheDocument();
  });

  it("原始密码太弱时不让保存", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("原始密码"), "short");
    await user.click(screen.getByRole("button", { name: "设置原始密码" }));

    expect(lastToast()).toBe("原始密码至少 8 位");
    expect(useMockSettings.getState().settings.originalPasswordConfigured).toBe(false);
  });
});
