/* ==========================================================================
   管理端练习开放单 · HTTP 模式
   --------------------------------------------------------------------------
   断言的是页面上真正能看到的东西：开放单清单、状态与开放范围，
   以及新建 / 上架 / 下架时**发出去的请求**。

   mock 模式走的是本地数据通路，验不到「有没有把状态码当查询参数发给后端」
   这类问题——所以这里把 API 层整个换掉，只留页面。
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/** 被测的 API 函数。 */
const api = {
  loadPracticeAssignments: vi.fn(),
  createPracticeAssignment: vi.fn(),
  updatePracticeAssignment: vi.fn(),
  publishPracticeAssignment: vi.fn(),
  archivePracticeAssignment: vi.fn(),
  loadPapers: vi.fn(),
  loadOrgTags: vi.fn(),
};

vi.mock("@exam/shared/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBackendEnabled: () => true,
  ...api,
}));

const { PracticeAssignmentListPage } = await import("../PracticeAssignmentListPage");

/** 后端返回的一条开放单。 */
const ASSIGNMENT = {
  id: "12",
  title: "数据结构 · 树与查找专题",
  paperId: "34",
  paperName: "数据结构 · 树与查找（练习卷）",
  questionCount: 5,
  totalScore: 25,
  status: "published",
  statusLabel: "已上架",
  scopeTagIds: ["7", "9"],
  scopeTagNames: ["计算机科学 2023 级 1 班", "计算机科学 2023 级 2 班"],
  openAt: "2026-11-15T00:00:00Z",
  closeAt: null,
  publishedAt: "2026-11-15T08:05:00Z",
  createdAt: "2026-11-14T02:12:00Z",
  attemptCount: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.loadPracticeAssignments.mockResolvedValue({
    items: [ASSIGNMENT],
    total: 1,
    page: 1,
    size: 20,
  });
  api.loadPapers.mockResolvedValue({
    items: [
      {
        id: "34",
        kind: "practice",
        kindLabel: "练习卷",
        name: "数据结构 · 树与查找（练习卷）",
        status: "published",
        statusLabel: "已发布",
        itemCount: 5,
        totalItemScore: 25,
      },
    ],
    total: 1,
  });
  api.loadOrgTags.mockResolvedValue([
    { id: "7", code: "class-2301", name: "计算机科学 2023 级 1 班", parentId: null },
    { id: "9", code: "class-2302", name: "计算机科学 2023 级 2 班", parentId: null },
  ]);
  api.createPracticeAssignment.mockResolvedValue(ASSIGNMENT);
  api.updatePracticeAssignment.mockResolvedValue(ASSIGNMENT);
  api.publishPracticeAssignment.mockResolvedValue(ASSIGNMENT);
  api.archivePracticeAssignment.mockResolvedValue(ASSIGNMENT);
});

describe("管理端练习开放单 · HTTP 模式", () => {
  it("渲染开放单清单：状态、开放范围与次数", async () => {
    render(
      <MemoryRouter>
        <PracticeAssignmentListPage />
      </MemoryRouter>,
    );

    const title = await screen.findByText("数据结构 · 树与查找专题");
    const row = title.closest("tr")!;
    expect(within(row).getByText("已上架")).toBeInTheDocument();
    expect(within(row).getByText("计算机科学 2023 级 1 班")).toBeInTheDocument();
    expect(within(row).getByText("计算机科学 2023 级 2 班")).toBeInTheDocument();
    // 题量 · 总分与作答次数。
    expect(within(row).getByText("5 题 · 25 分")).toBeInTheDocument();
    expect(within(row).getByText("3")).toBeInTheDocument();
  });

  it("状态筛选把状态码当查询参数发给服务端", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PracticeAssignmentListPage />
      </MemoryRouter>,
    );
    await screen.findByText("数据结构 · 树与查找专题");

    await user.click(screen.getByRole("button", { name: "已上架" }));

    await waitFor(() => {
      const calls = api.loadPracticeAssignments.mock.calls;
      const last = calls[calls.length - 1]?.[0] as { status?: string };
      expect(last.status).toBe("published");
    });
  });

  it("新建开放单：挂练习卷、选开放范围，发出去的请求带得上", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PracticeAssignmentListPage />
      </MemoryRouter>,
    );
    await screen.findByText("数据结构 · 树与查找专题");

    await user.click(screen.getByRole("button", { name: "新建开放单" }));
    const dialog = screen.getByRole("dialog");

    await user.type(within(dialog).getByLabelText(/开放单标题/), "期末冲刺练习");
    await user.selectOptions(within(dialog).getByLabelText(/练习卷/), "34");
    // 开放范围：只勾一个班。
    await user.click(within(dialog).getByRole("button", { name: "计算机科学 2023 级 1 班" }));
    await user.click(within(dialog).getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(api.createPracticeAssignment).toHaveBeenCalledTimes(1);
    });
    const input = api.createPracticeAssignment.mock.calls[0]![0] as {
      paperId: string;
      title: string;
      scopeTagIds: string[];
    };
    expect(input.paperId).toBe("34");
    expect(input.title).toBe("期末冲刺练习");
    expect(input.scopeTagIds).toEqual(["7"]);
  });

  it("上架与下架打各自的端点", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PracticeAssignmentListPage />
      </MemoryRouter>,
    );
    await screen.findByText("数据结构 · 树与查找专题");

    // 已上架的行只有「下架」。
    await user.click(screen.getByRole("button", { name: "下架" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "确认下架" }));

    await waitFor(() => {
      expect(api.archivePracticeAssignment).toHaveBeenCalledWith("12");
    });
  });
});
