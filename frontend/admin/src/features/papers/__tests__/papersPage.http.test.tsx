/* ==========================================================================
   管理端组卷 · HTTP 模式
   --------------------------------------------------------------------------
   断言的是页面上真正能看到的东西与服务端发出去的请求：
   试卷清单、基本信息保存、选题配分、发布校验与发布。
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/** 被测的 API 函数。 */
const api = {
  loadPapers: vi.fn(),
  loadPaper: vi.fn(),
  createPaper: vi.fn(),
  updatePaper: vi.fn(),
  deletePaper: vi.fn(),
  replacePaperItems: vi.fn(),
  validatePaper: vi.fn(),
  publishPaper: vi.fn(),
  unpublishPaper: vi.fn(),
  previewPaper: vi.fn(),
  loadPaperTemplates: vi.fn(),
  saveBlueprint: vi.fn(),
  generateBlueprint: vi.fn(),
  applyPaperTemplate: vi.fn(),
  createPaperTemplate: vi.fn(),
  loadQuestions: vi.fn(),
  loadQuestion: vi.fn(),
  loadQuestionTags: vi.fn(),
};

vi.mock("@exam/shared/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBackendEnabled: () => true,
  ...api,
}));

const { PaperListPage } = await import("../PaperListPage");
const { PaperWizardPage } = await import("../PaperWizardPage");

/** 服务端试卷摘要。 */
const PAPER = {
  id: "12",
  kind: "exam",
  kindLabel: "考试卷",
  name: "期中考试卷",
  batch: "2026 秋季 · 期中",
  description: "",
  status: "draft",
  statusLabel: "草稿",
  targetTotalScore: 100,
  totalItemScore: 40,
  durationMinutes: 60,
  passScore: 60,
  itemCount: 1,
  createdAt: "2026-11-19T08:00:00Z",
  updatedAt: null,
};

/** 服务端试卷详情。 */
const DETAIL = {
  paper: PAPER,
  items: [
    { id: "30", questionId: "5", score: 40, sortOrder: 0, sectionId: null },
  ],
  sections: [],
  tagIds: [],
  orderRule: "by_type",
  variantRule: "small_plum",
  answerPolicy: "after_close",
  allowRetake: false,
  retakeKeepsBest: true,
  note: "考生须知",
  examRules: null,
  practiceRules: null,
  publishedSnapshotId: null,
};

/** 服务端的题目摘要（还没入卷的候选题）。 */
const QUESTION = {
  id: "6",
  code: "Q-5",
  type: "single",
  typeLabel: "单选题",
  stem: "TCP 属于哪一层协议？",
  defaultScore: 5,
  status: "published",
  statusLabel: "已发布",
  source: "manual",
  difficultyTagId: "1",
  tagIds: ["1"],
  createdAt: "2026-11-18T08:00:00Z",
  updatedAt: null,
};

/** 渲染带路由的页面。 */
function renderList() {
  return render(
    <MemoryRouter initialEntries={["/papers?kind=exam"]}>
      <Routes>
        <Route path="*" element={<PaperListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderWizard(step: string) {
  return render(
    <MemoryRouter initialEntries={[`/papers/12?kind=exam&step=${step}`]}>
      <Routes>
        <Route path="/papers/:paperId" element={<PaperWizardPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("管理端组卷 · HTTP 模式", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.loadPapers.mockResolvedValue({ items: [PAPER], total: 1 });
    api.loadPaper.mockResolvedValue(DETAIL);
    api.updatePaper.mockResolvedValue(DETAIL);
    api.createPaper.mockResolvedValue(DETAIL);
    api.deletePaper.mockResolvedValue(undefined);
    api.replacePaperItems.mockResolvedValue(DETAIL);
    api.validatePaper.mockResolvedValue({
      items: [
        { key: "count", label: "题目数量", passed: true, severity: "blocking", detail: null, targets: [] },
        {
          key: "durationFit",
          label: "时长匹配",
          passed: false,
          severity: "warning",
          detail: "题均 30.0 分钟，超出建议区间。",
          targets: [],
        },
      ],
      canPublish: true,
      hasBlockingFailure: false,
    });
    api.publishPaper.mockResolvedValue(DETAIL);
    api.unpublishPaper.mockResolvedValue(DETAIL);
    api.previewPaper.mockResolvedValue({
      variantKey: "v1",
      rule: "small_plum",
      ruleLabel: "小梅花",
      itemCount: 1,
      totalScore: 40,
      items: [
        {
          questionId: "5",
          questionCode: "Q-5",
          type: "single",
          typeLabel: "单选题",
          stem: "TCP 属于哪一层协议？",
          options: [
            { key: "B", text: "传输层" },
            { key: "A", text: "网络层" },
          ],
          score: 40,
          sortOrder: 0,
          sectionTitle: "",
        },
      ],
    });
    api.loadPaperTemplates.mockResolvedValue({ items: [], total: 0 });
    api.saveBlueprint.mockResolvedValue({ id: "1", paperId: "12" });
    api.generateBlueprint.mockResolvedValue({
      blueprintId: "1",
      status: "generated",
      seed: "s",
      generatedItemCount: 0,
      items: [],
      totalScore: 0,
      diff: { added: [], removed: [], changed: [] },
    });
    api.loadQuestions.mockResolvedValue({ items: [QUESTION], total: 1 });
    api.loadQuestion.mockResolvedValue({ ...QUESTION, options: [], answer: [] });
    api.loadQuestionTags.mockResolvedValue([
      { id: "1", name: "基础", group: "difficulty", groupLabel: "难度", level: 1 },
    ]);
  });

  it("组卷清单显示服务端试卷与题量", async () => {
    renderList();

    await waitFor(() => {
      expect(screen.getByText("期中考试卷")).toBeInTheDocument();
    });
    expect(screen.getByText("2026 秋季 · 期中")).toBeInTheDocument();
    expect(screen.getByText("草稿")).toBeInTheDocument();
    // 题量来自服务端摘要。
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("删除试卷走服务端的删除端点", async () => {
    const user = userEvent.setup();
    renderList();

    await waitFor(() => {
      expect(screen.getByText("期中考试卷")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(api.deletePaper).toHaveBeenCalledWith("12");
    });
  });

  it("基本信息按服务端口径保存（题序 / 卷型 / 公布时机）", async () => {
    const user = userEvent.setup();
    renderWizard("basic");

    await waitFor(() => {
      expect(screen.getByDisplayValue("期中考试卷")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "保存并选择题目" }));

    await waitFor(() => {
      expect(api.updatePaper).toHaveBeenCalledTimes(1);
    });
    const body = api.updatePaper.mock.calls[0]![1];
    expect(body).toMatchObject({
      name: "期中考试卷",
      batch: "2026 秋季 · 期中",
      orderRule: "by_type",
      variantRule: "small_plum",
      answerPolicy: "after_close",
      targetTotalScore: 100,
      durationMinutes: 60,
    });
  });

  it("选题配分走整体替换题位端点", async () => {
    const user = userEvent.setup();
    renderWizard("select");

    await waitFor(() => {
      expect(screen.getByText("TCP 属于哪一层协议？")).toBeInTheDocument();
    });

    // 勾一道题（候选清单里的勾选框）。
    const pickList = document.querySelector(".pick-list") as HTMLElement;
    await user.click(within(pickList).getByRole("checkbox"));

    await waitFor(() => {
      expect(api.replacePaperItems).toHaveBeenCalled();
    });
    expect(api.replacePaperItems.mock.calls[0]![1]).toEqual([
      { questionId: "5", score: 40, sortOrder: 0 },
      { questionId: "6", score: 5, sortOrder: 1 },
    ]);
  });

  it("发布前校验来自服务端，警告项要填理由才能发布", async () => {
    const user = userEvent.setup();
    renderWizard("publish");

    await waitFor(() => {
      expect(api.validatePaper).toHaveBeenCalled();
    });
    // 校验清单与覆盖理由弹窗里都有这个词，取清单里的那一个。
    await waitFor(() => {
      expect(screen.getAllByText("时长匹配").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("题均 30.0 分钟，超出建议区间。").length).toBeGreaterThan(0);

    // 有警告项：先要覆盖理由。
    await user.click(screen.getByRole("button", { name: "发布考试" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(api.publishPaper).not.toHaveBeenCalled();

    // 填理由后发布。
    await user.type(
      screen.getByLabelText(/时长匹配/),
      "本次侧重主观题作答能力",
    );
    await user.click(screen.getByRole("button", { name: "确认发布" }));

    await waitFor(() => {
      expect(api.publishPaper).toHaveBeenCalledTimes(1);
    });
    expect(api.publishPaper.mock.calls[0]![1]).toContain("本次侧重主观题作答能力");
  });
});
