/* ==========================================================================
   管理端用户页 · HTTP 模式
   --------------------------------------------------------------------------
   断言的是**页面上真正能看到的东西**与**发出去的请求**：
   用户列表、组织归属、角色徽标、停用账号、名单导入的失败明细。
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/** 被测的 API 函数。 */
const api = {
  loadUserPage: vi.fn(),
  loadRoles: vi.fn(),
  loadOrgTags: vi.fn(),
  assignUserRoles: vi.fn(),
  assignUserTags: vi.fn(),
  updateAdminUser: vi.fn(),
  importUserRoster: vi.fn(),
};

vi.mock("@exam/shared/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBackendEnabled: () => true,
  ...api,
}));

const { UsersPage } = await import("../UsersPage");

// jsdom 的 File 没有 arrayBuffer()，补一个基于 FileReader 的实现。
const filePrototype = File.prototype as unknown as {
  arrayBuffer?: () => Promise<ArrayBuffer>;
};
if (!filePrototype.arrayBuffer) {
  filePrototype.arrayBuffer = function arrayBuffer(this: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

/** 后端用户条目。 */
const USER = {
  id: "32",
  username: "t1061794989263723",
  displayName: "林知遥",
  email: "lin@example.edu",
  phone: "",
  status: "active",
  mustChangePassword: true,
  roles: ["student"],
  roleIds: ["5"],
  organizationTagIds: ["6"],
  organizationPath: "计算机学院 / 计算机科学与技术 / 计科 2301 班",
  createdAt: "2026-11-18T08:07:43Z",
  lastLoginAt: null,
};

/** 角色目录。 */
const ROLES = [
  { id: "1", code: "system_admin", name: "系统管理员", description: "", isSystem: true, permissions: [] },
  { id: "5", code: "student", name: "学生", description: "", isSystem: true, permissions: [] },
];

describe("管理端用户页 · HTTP 模式", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.loadUserPage.mockResolvedValue({ items: [USER], total: 1 });
    api.loadRoles.mockResolvedValue(ROLES);
    api.loadOrgTags.mockResolvedValue([
      { id: "6", code: "org.计科-2301-班", name: "计科 2301 班", parentId: "5" },
    ]);
    api.updateAdminUser.mockResolvedValue({ ...USER, status: "disabled" });
    api.assignUserRoles.mockResolvedValue(USER);
    api.assignUserTags.mockResolvedValue({ userId: "32", tags: [], path: "" });
    api.importUserRoster.mockResolvedValue({
      total: 2,
      succeeded: 1,
      created: 1,
      updated: 0,
      failures: [{ rowNumber: 3, username: "bad!", reason: "账号格式不正确。" }],
      generatedPasswords: [{ username: "t1061794989263723", password: "vtDjhbWjsrXNMmF5aA1" }],
    });
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <Routes>
          <Route path="*" element={<UsersPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("列表显示后端用户、角色与组织归属", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("t1061794989263723")).toBeInTheDocument();
    });

    expect(screen.getByText("林知遥")).toBeInTheDocument();
    // 角色徽标用后端给的角色名。
    expect(screen.getAllByText("学生").length).toBeGreaterThan(0);
    // 组织标签是标签 ID 挂上来的，名称来自标签目录（标签目录晚一步到）。
    await waitFor(() => {
      expect(screen.getByText("计科 2301 班")).toBeInTheDocument();
    });
    // 待改密码的标记来自后端。
    expect(screen.getByText("待改密码")).toBeInTheDocument();
  });

  it("停用账号把整份档案原样带回，只改状态", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("t1061794989263723")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "停用" }));

    await waitFor(() => {
      expect(api.updateAdminUser).toHaveBeenCalledTimes(1);
    });
    const [id, payload] = api.updateAdminUser.mock.calls[0]!;
    expect(id).toBe("32");
    expect(payload.status).toBe("disabled");
    // 档案接口是整份覆盖：姓名与邮箱不能发空。
    expect(payload.displayName).toBe("林知遥");
    expect(payload.email).toBe("lin@example.edu");
  });

  it("角色筛选把角色 ID 交给服务端", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(api.loadRoles).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "学生" }));

    await waitFor(() => {
      const last = api.loadUserPage.mock.calls.at(-1)![0];
      expect(last.roleId).toBe("5");
    });
  });

  it("名单导入把原文件交给服务端，并显示失败明细", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /批量导入/ }));

    const file = new File(
      ["账号,姓名,学院,专业,班级\nt1061794989263723,林知遥,计算机学院,计算机科学与技术,计科 2301 班\n"],
      "roster.csv",
      { type: "text/csv" },
    );
    const input = screen.getByLabelText("名单文件") as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText("确认导入")).not.toBeDisabled();
    });

    await user.click(screen.getByRole("button", { name: "确认导入" }));

    await waitFor(() => {
      expect(api.importUserRoster).toHaveBeenCalledTimes(1);
    });
    expect(api.importUserRoster.mock.calls[0]![0].name).toBe("roster.csv");

    // 服务端返回的失败明细与初始密码都要显示出来。
    await waitFor(() => {
      expect(screen.getByText(/账号格式不正确/)).toBeInTheDocument();
    });
    expect(screen.getByText("vtDjhbWjsrXNMmF5aA1")).toBeInTheDocument();
  });
});
