/* ==========================================================================
   管理端概览（看板拼装）· HTTP 模式
   --------------------------------------------------------------------------
   后端没有「管理端仪表盘」这一个端点：数字由各资源自己数，前端拼起来。
   断言的是拼出来的看板与各资源的请求。
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/** 被测的 API 函数。 */
const api = {
  countUsers: vi.fn(),
  loadAdminSessions: vi.fn(),
  loadBanks: vi.fn(),
  loadImportBatches: vi.fn(),
  loadPaperTemplates: vi.fn(),
  loadPapers: vi.fn(),
  loadQuestions: vi.fn(),
  loadReviewCounts: vi.fn(),
  validatePaper: vi.fn(),
};

vi.mock("@exam/shared/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBackendEnabled: () => true,
  ...api,
}));

const { OverviewPage } = await import("../OverviewPage");

/** 服务端的题目分页。 */
function page(total: number) {
  return { items: [], total };
}

describe("管理端概览 · HTTP 模式", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.loadQuestions.mockImplementation(async (params: { status?: string }) => {
      if (params.status === "published") return page(30);
      if (params.status === "draft") return page(8);
      if (params.status === "disabled") return page(4);
      return page(42);
    });
    api.loadBanks.mockResolvedValue([{ id: "1", name: "题库", description: "", questionCount: 42 }]);
    api.loadPapers.mockImplementation(async (params: { kind?: string }) =>
      params.kind === "practice"
        ? { items: [{ id: "21", kind: "practice", name: "练习", status: "draft", statusLabel: "草稿" }], total: 1 }
        : { items: [{ id: "12", kind: "exam", name: "试卷", status: "draft", statusLabel: "草稿" }], total: 1 },
    );
    api.loadReviewCounts.mockResolvedValue({ pending: 3, inReview: 1, reviewed: 9, mine: 2 });
    api.loadAdminSessions.mockResolvedValue([
      { id: "7", name: "场次", status: "in_progress", statusLabel: "进行中", publishedAt: "2026-11-18T07:50:00Z" },
      { id: "8", name: "场次二", status: "scheduled", statusLabel: "未开始", publishedAt: null },
    ]);
    api.countUsers.mockResolvedValue(12);
    api.loadPaperTemplates.mockResolvedValue({ items: [], total: 0 });
    api.loadImportBatches.mockResolvedValue({ items: [], total: 0 });
    api.validatePaper.mockResolvedValue({
      items: [{ key: "count", label: "题目数量", passed: false, severity: "blocking", detail: null, targets: [] }],
      canPublish: false,
      hasBlockingFailure: true,
    });
  });

  it("看板把各资源的数字拼起来", async () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <Routes>
          <Route path="*" element={<OverviewPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(api.loadQuestions).toHaveBeenCalled();
    });

    // 题目总数 42（四个状态分别取总数）。
    const stats = screen.getByText("题目总数").closest("div")?.parentElement;
    expect(stats).toBeTruthy();
    expect(within(stats as HTMLElement).getByText("42")).toBeInTheDocument();
    expect(within(stats as HTMLElement).getByText(/覆盖 1 个题库/)).toBeInTheDocument();

    // 待阅卷 3 份。
    const review = screen.getByText("待阅卷").closest("div")?.parentElement;
    expect(within(review as HTMLElement).getByText("3")).toBeInTheDocument();

    // 进行中场次 1 场（共 2 场 · 12 个账号）。
    const sessions = screen.getByText("进行中场次").closest("div")?.parentElement;
    expect(within(sessions as HTMLElement).getAllByText("1").length).toBeGreaterThan(0);
    expect(within(sessions as HTMLElement).getByText(/共 2 场 · 12 个账号/)).toBeInTheDocument();
  });

  it("发布校验未通过的卷逐卷校验后计入待办", async () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <Routes>
          <Route path="*" element={<OverviewPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(api.validatePaper).toHaveBeenCalled();
    });
    // 两份草稿卷（试卷 + 练习）都校验。
    expect(api.validatePaper).toHaveBeenCalledTimes(2);

    const card = screen.getByText("发布校验未通过").closest("article");
    expect(card).toBeTruthy();
    expect(within(card as HTMLElement).getByText("2")).toBeInTheDocument();
  });
});
