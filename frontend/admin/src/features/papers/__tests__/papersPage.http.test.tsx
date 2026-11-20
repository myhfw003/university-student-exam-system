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
  archivePaper: vi.fn(),
  previewPaper: vi.fn(),
  loadPaperTemplates: vi.fn(),
  loadPaperTemplate: vi.fn(),
  saveBlueprint: vi.fn(),
  generateBlueprint: vi.fn(),
  applyPaperTemplate: vi.fn(),
  createPaperTemplate: vi.fn(),
  loadQuestions: vi.fn(),
  loadQuestion: vi.fn(),
  loadQuestionTags: vi.fn(),
  loadPaperSnapshots: vi.fn(),
  loadPaperSnapshot: vi.fn(),
  loadLatestPaperSnapshot: vi.fn(),
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

/** 服务端的卷型模板。 */
const TEMPLATE = {
  id: "7",
  name: "期末复习卷",
  kind: "exam",
  kindLabel: "考试卷",
  variantRule: "standard",
  variantRuleLabel: "标准卷",
  durationMinutes: 30,
  passScore: null,
  itemCount: 1,
  totalScore: 10,
  sourcePaperId: "12",
  createdAt: "2026-11-20T09:00:00Z",
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
    api.archivePaper.mockResolvedValue({ ...DETAIL, paper: { ...PAPER, status: "archived", statusLabel: "已归档" } });
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
    api.loadPaperTemplate.mockResolvedValue({
      template: TEMPLATE,
      items: [{ questionId: "5", score: 10, sortOrder: 0 }],
    });
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
    api.loadPaperSnapshots.mockResolvedValue([
      {
        id: "5",
        paperId: "12",
        version: 2,
        contentHash: "abcdef0123456789",
        itemCount: 1,
        totalScore: 40,
        createdAt: "2026-11-19T09:00:00Z",
        createdBy: "3",
      },
    ]);
    api.loadLatestPaperSnapshot.mockResolvedValue({
      id: "6",
      paperId: "12",
      version: 3,
      contentHash: "beef0123456789ab",
      itemCount: 1,
      totalScore: 40,
      createdAt: "2026-11-20T09:00:00Z",
      createdBy: "3",
      items: [
        {
          id: "31",
          questionId: "5",
          questionCode: "Q-5",
          questionType: "single",
          stem: "当前生效版本里的题目",
          options: [{ key: "B", text: "网络层" }],
          correctKeys: ["B"],
          keypoints: [],
          steps: [],
          analysis: null,
          referenceAnswer: null,
          attachments: [],
          score: 40,
          sortOrder: 1,
          sectionTitle: null,
        },
      ],
    });
    api.loadPaperSnapshot.mockResolvedValue({
      id: "5",
      paperId: "12",
      version: 2,
      contentHash: "abcdef0123456789",
      itemCount: 1,
      totalScore: 40,
      createdAt: "2026-11-19T09:00:00Z",
      createdBy: "3",
      items: [
        {
          id: "30",
          questionId: "5",
          questionCode: "Q-5",
          questionType: "single",
          stem: "TCP 属于哪一层协议？",
          options: [{ key: "A", text: "传输层" }],
          correctKeys: ["A"],
          keypoints: [],
          steps: [],
          analysis: "传输层负责端到端传输。",
          referenceAnswer: null,
          attachments: [],
          score: 40,
          sortOrder: 1,
          sectionTitle: null,
        },
      ],
    });
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

  it("版本历史：能打开某一版快照看冻结的卷面", async () => {
    const user = userEvent.setup();
    renderWizard("publish");

    await waitFor(() => {
      expect(screen.getByText("第 2 版")).toBeInTheDocument();
    });

    const row = screen.getByText("第 2 版").closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "查看" }));

    await waitFor(() => {
      expect(api.loadPaperSnapshot).toHaveBeenCalledWith("12", 2);
    });

    // 冻结的题目与正确答案都在弹窗里。
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("TCP 属于哪一层协议？")).toBeInTheDocument();
    expect(within(dialog).getByText("A")).toBeInTheDocument();
  });

  it("当前生效版本：走 /snapshots/latest", async () => {
    const user = userEvent.setup();
    renderWizard("publish");

    await waitFor(() => {
      expect(screen.getByText("第 2 版")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "查看当前生效版本" }));

    await waitFor(() => {
      expect(api.loadLatestPaperSnapshot).toHaveBeenCalledWith("12");
    });
    expect(screen.getByText("当前生效版本里的题目")).toBeInTheDocument();
  });

  it("归档试卷：先确认后果，再走服务端的归档端点", async () => {
    const user = userEvent.setup();
    renderWizard("publish");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "归档" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "归档" }));

    // 确认框要说清楚后果，再让管理员点头。
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/不能再用于发布新的考试场次/)).toBeInTheDocument();
    expect(api.archivePaper).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "确认归档" }));

    await waitFor(() => {
      expect(api.archivePaper).toHaveBeenCalledWith("12");
    });
  });

  it("卷型模板：能看模板的题位清单（题号、题干、分值）", async () => {
    const user = userEvent.setup();
    api.loadPaperTemplates.mockResolvedValue({ items: [TEMPLATE], total: 1 });
    renderWizard("select");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "查看题位清单" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "查看题位清单" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("期末复习卷")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "查看题位" }));

    await waitFor(() => {
      expect(api.loadPaperTemplate).toHaveBeenCalledWith("7");
    });
    // 题位清单：题号、题干、分值都在（题干是按题目 ID 现取的）。
    expect(await within(dialog).findByText("「期末复习卷」的题位清单")).toBeInTheDocument();
    expect(within(dialog).getByText("TCP 属于哪一层协议？")).toBeInTheDocument();
    expect(within(dialog).getByText("Q-5")).toBeInTheDocument();
  });

  it("已归档的试卷：状态照服务端显示，归档按钮不再出现", async () => {    api.loadPaper.mockResolvedValue({
      ...DETAIL,
      paper: { ...PAPER, status: "archived", statusLabel: "已归档" },
    });
    renderWizard("publish");

    await waitFor(() => {
      expect(screen.getByText("已归档")).toBeInTheDocument();
    });
    // 归档过的试卷不能再归档；发布按钮变成「重新发布」。
    expect(screen.queryByRole("button", { name: "归档" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新发布" })).toBeInTheDocument();
  });
});
