/* ==========================================================================
   管理端角色页 · HTTP 模式
   --------------------------------------------------------------------------
   断言的是**页面上真正能看到的东西**与**发出去的请求**：
   角色清单、权限点目录（服务端给的中文名与模块），以及保存时
   发出去的权限集合是**整体覆盖**（勾了什么就是什么）。
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/** 被测的 API 函数。 */
const api = {
  loadRoles: vi.fn(),
  loadPermissions: vi.fn(),
  updateRole: vi.fn(),
};

vi.mock("@exam/shared/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBackendEnabled: () => true,
  ...api,
}));

const { RoleListPage } = await import("../RoleListPage");

/** 服务端的角色目录。 */
const ROLES = [
  {
    id: "4",
    code: "grader_teacher",
    name: "阅卷教师",
    description: "只阅卷",
    isSystem: true,
    permissions: ["paper:read"],
  },
];

/** 服务端的权限点目录。 */
const PERMISSIONS = [
  { code: "paper:read", name: "查看试卷", module: "paper", description: null },
  { code: "paper:write", name: "编辑试卷", module: "paper", description: null },
];

describe("管理端角色页 · HTTP 模式", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.loadRoles.mockResolvedValue(ROLES);
    api.loadPermissions.mockResolvedValue(PERMISSIONS);
    api.updateRole.mockResolvedValue({ ...ROLES[0], permissions: ["paper:write"] });
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <Routes>
          <Route path="*" element={<RoleListPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("列出角色，权限矩阵按服务端给的权限点目录渲染", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("阅卷教师")).toBeInTheDocument();
    });
    expect(screen.getByText("只阅卷")).toBeInTheDocument();
    // 系统内置角色标出来了。
    expect(screen.getByText("系统内置")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "编辑权限" }));
    const dialog = screen.getByRole("dialog");
    // 权限点用服务端给的中文名，按模块分组。
    expect(within(dialog).getByText("查看试卷")).toBeInTheDocument();
    expect(within(dialog).getByText("编辑试卷")).toBeInTheDocument();
    expect(within(dialog).getByText("paper")).toBeInTheDocument();
  });

  it("保存时权限集合是整体覆盖：勾了什么就发什么", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("阅卷教师")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "编辑权限" }));
    const dialog = screen.getByRole("dialog");

    // 勾掉「查看试卷」、勾上「编辑试卷」，再保存。
    await user.click(within(dialog).getByRole("button", { name: "查看试卷" }));
    await user.click(within(dialog).getByRole("button", { name: "编辑试卷" }));
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(api.updateRole).toHaveBeenCalledTimes(1);
    });
    expect(api.updateRole.mock.calls[0]![0]).toBe("4");
    expect(api.updateRole.mock.calls[0]![1]).toMatchObject({
      permissionCodes: ["paper:write"],
    });
  });
});
