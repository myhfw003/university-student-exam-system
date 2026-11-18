/* ==========================================================================
   管理端标签页 · HTTP 模式
   --------------------------------------------------------------------------
   断言的是页面上真正能看到的东西：标签分组、编码、挂载总数，
   以及新建时派生出来的编码。
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/** 被测的 API 函数。 */
const api = {
  loadAdminTags: vi.fn(),
  createAdminTag: vi.fn(),
  updateAdminTag: vi.fn(),
  deleteAdminTag: vi.fn(),
};

vi.mock("@exam/shared/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBackendEnabled: () => true,
  ...api,
}));

const { TagsPage } = await import("../TagsPage");

/** 后端标签。 */
const TAGS = [
  {
    id: "1",
    code: "domain.极限与连续",
    name: "极限与连续",
    group: "domain",
    groupLabel: "领域",
    parentId: null,
    level: null,
    description: "",
    sortOrder: 0,
    isSystem: false,
    usageCount: 12,
  },
  {
    id: "2",
    code: "difficulty.基础",
    name: "基础",
    group: "difficulty",
    groupLabel: "难度",
    parentId: null,
    level: 1,
    description: "",
    sortOrder: 0,
    isSystem: true,
    usageCount: 30,
  },
];

describe("管理端标签页 · HTTP 模式", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.loadAdminTags.mockResolvedValue(TAGS);
    api.createAdminTag.mockResolvedValue(TAGS[0]);
    api.updateAdminTag.mockResolvedValue(TAGS[0]);
    api.deleteAdminTag.mockResolvedValue(undefined);
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <Routes>
          <Route path="*" element={<TagsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("按维度列出标签，显示编码与挂载总数", async () => {
    renderPage();

    await waitFor(() => {
      // 标签名在表格与「上级标签」下拉里各有一处。
      expect(screen.getAllByText("极限与连续").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("domain.极限与连续")).toBeInTheDocument();
    expect(screen.getAllByText("基础").length).toBeGreaterThan(0);
    // 挂载总数来自服务端。
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("新建标签时按分组与名称派生编码", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /新建标签/ }));
    await user.type(screen.getByLabelText(/标签名称/), "线性代数");
    await user.click(screen.getByRole("button", { name: "保存标签" }));

    await waitFor(() => {
      expect(api.createAdminTag).toHaveBeenCalledTimes(1);
    });
    const payload = api.createAdminTag.mock.calls[0]![0];
    expect(payload.name).toBe("线性代数");
    expect(payload.group).toBe("domain");
    expect(payload.code).toBe("domain.线性代数");
    // 难度维度才带等级。
    expect(payload.level).toBeNull();
  });

  it("新建难度标签时带上推导出的等级", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /新建标签/ }));
    await user.type(screen.getByLabelText(/标签名称/), "较难");
    await user.selectOptions(screen.getByLabelText(/所属分组/), "difficulty");
    await user.click(screen.getByRole("button", { name: "保存标签" }));

    await waitFor(() => {
      expect(api.createAdminTag).toHaveBeenCalledTimes(1);
    });
    const payload = api.createAdminTag.mock.calls[0]![0];
    expect(payload.group).toBe("difficulty");
    expect(payload.level).toBe(3);
  });

  it("删除标签先二次确认，再调用服务端", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("domain.极限与连续")).toBeInTheDocument();
    });

    // 点该行右侧的「删除」（按编码定位行：标签名在别处也会出现）。
    const row = screen.getByText("domain.极限与连续").closest("tr");
    const deleteButton = row?.querySelector("button.btn-danger");
    await user.click(deleteButton as HTMLElement);

    expect(api.deleteAdminTag).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(api.deleteAdminTag).toHaveBeenCalledWith("1");
    });
  });
});
