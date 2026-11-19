/* ==========================================================================
   管理端题库与工作台 · HTTP 模式
   --------------------------------------------------------------------------
   断言的是页面上真正能看到的东西与服务端发出去的请求：
   题库清单与统计、题目列表、状态变更、批量发布。
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/** 被测的 API 函数。 */
const api = {
  loadBanks: vi.fn(),
  loadBank: vi.fn(),
  loadQuestions: vi.fn(),
  loadQuestion: vi.fn(),
  createBank: vi.fn(),
  updateBank: vi.fn(),
  deleteBank: vi.fn(),
  addBankItems: vi.fn(),
  removeBankItems: vi.fn(),
  createQuestion: vi.fn(),
  updateQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  setQuestionStatus: vi.fn(),
  batchQuestionStatus: vi.fn(),
  uploadImportBatch: vi.fn(),
  loadQuestionTags: vi.fn(),
  uploadQuestionAttachment: vi.fn(),
  updateImportMapping: vi.fn(),
  adoptImportBatch: vi.fn(),
};

vi.mock("@exam/shared/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBackendEnabled: () => true,
  ...api,
}));

const { BanksPage } = await import("../BanksPage");
const { BankWorkbenchPage } = await import("../BankWorkbenchPage");

/** 后端题库。 */
const BANK = {
  id: "3",
  name: "计算机网络基础题库",
  description: "覆盖 TCP / UDP 与协议栈",
  questionCount: 2,
};

/** 后端题库详情。 */
const BANK_DETAIL = {
  bank: BANK,
  questions: [
    {
      id: "30",
      code: "Q-30",
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
    },
    {
      id: "31",
      code: "Q-31",
      type: "short",
      typeLabel: "简答题",
      stem: "简述 TCP 的三次握手。",
      defaultScore: 10,
      status: "draft",
      statusLabel: "草稿",
      source: "import",
      difficultyTagId: "1",
      tagIds: ["1"],
      createdAt: "2026-11-18T08:00:00Z",
      updatedAt: null,
    },
  ],
  statistics: {
    total: 2,
    draft: 1,
    published: 1,
    disabled: 0,
    objectiveCount: 1,
    objectiveScore: 5,
    subjectiveCount: 1,
    subjectiveScore: 10,
  },
};

describe("管理端题库 · HTTP 模式", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.loadBanks.mockResolvedValue([BANK]);
    api.loadBank.mockResolvedValue(BANK_DETAIL);
    api.loadQuestions.mockResolvedValue({ items: BANK_DETAIL.questions, total: 2 });
    api.loadQuestion.mockResolvedValue({
      ...BANK_DETAIL.questions[0],
      options: [
        { key: "A", text: "网络层", isCorrect: false },
        { key: "B", text: "传输层", isCorrect: true },
      ],
      answer: [],
      keypoints: [],
      steps: [],
      attachments: [],
      analysis: "",
      reference: "",
    });
    api.uploadQuestionAttachment.mockResolvedValue({
      id: "1",
      fileName: "示意图.png",
      mimeType: "image/png",
      size: 1024,
      url: "",
    });
    api.setQuestionStatus.mockResolvedValue(undefined);
    // 服务端标签目录：真实后端的标签 ID 是数字主键。
    api.loadQuestionTags.mockResolvedValue([
      { id: "1", name: "基础", group: "difficulty", groupLabel: "难度", level: 1 },
    ]);
    api.batchQuestionStatus.mockResolvedValue({ total: 1, succeeded: 1, items: [] });
    api.createBank.mockResolvedValue(BANK_DETAIL);
    api.updateBank.mockResolvedValue(BANK_DETAIL);
    api.deleteBank.mockResolvedValue(undefined);
  });

  it("题库清单显示服务端题库与统计", async () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="*" element={<BanksPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("计算机网络基础题库")).toBeInTheDocument();
    });

    // 统计来自题库详情。
    expect(screen.getByText("覆盖 TCP / UDP 与协议栈")).toBeInTheDocument();
    // 题库在后端没有标签：如实说明，不显示成假的「—」。
    expect(screen.getByText("题库无标签")).toBeInTheDocument();
  });

  it("新建题库把名称与说明交给服务端", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Routes>
          <Route path="*" element={<BanksPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /新建题库/ }));
    await user.type(screen.getByLabelText(/题库名称/), "网络基础题库");
    await user.click(screen.getByRole("button", { name: "保存题库" }));

    await waitFor(() => {
      expect(api.createBank).toHaveBeenCalledTimes(1);
    });
    expect(api.createBank.mock.calls[0]![0]).toMatchObject({
      name: "网络基础题库",
      description: "",
    });
  });

  it("工作台显示服务端题目并按作答调用状态变更端点", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/banks/3?tab=questions"]}>
        <Routes>
          <Route path="/banks/:bankId" element={<BankWorkbenchPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("TCP 属于哪一层协议？")).toBeInTheDocument();
    });

    // 题号来自后端的 code（不是数字主键）。
    expect(screen.getByText("Q-30")).toBeInTheDocument();

    // 停用走「停用」端点。
    const stopButton = screen.getAllByRole("button", { name: "停用" })[0]!;
    await user.click(stopButton);

    await waitFor(() => {
      expect(api.setQuestionStatus).toHaveBeenCalledWith("30", "disable");
    });
  });

  it("新建题目用服务端的难度标签 ID 保存", async () => {
    api.createQuestion.mockResolvedValue({
      ...BANK_DETAIL.questions[0],
      id: "40",
      code: "Q-99",
      options: [],
      answer: [],
      keypoints: [],
      steps: [],
      attachments: [],
      analysis: "",
      reference: "",
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/banks/3?tab=questions"]}>
        <Routes>
          <Route path="/banks/:bankId" element={<BankWorkbenchPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("TCP 属于哪一层协议？")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /新建题目/ }));
    await user.type(screen.getByLabelText(/题目编号/), "Q-99");
    await user.type(screen.getByLabelText(/^题干/), "新建的题目");
    // 难度标签来自服务端目录（数字主键），不是本地目录的假 ID。
    await user.click(screen.getByRole("button", { name: "基础" }));
    await user.click(screen.getAllByLabelText("设为正确答案")[0]!);
    await user.click(screen.getByRole("button", { name: "保存题目" }));

    await waitFor(() => {
      expect(api.createQuestion).toHaveBeenCalledTimes(1);
    });
    expect(api.createQuestion.mock.calls[0]![0]).toMatchObject({
      code: "Q-99",
      difficultyTagId: "1",
      tagIds: ["1"],
    });
  });

  it("编辑题目先取回详情再打开编辑器", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/banks/3?tab=questions"]}>
        <Routes>
          <Route path="/banks/:bankId" element={<BankWorkbenchPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("TCP 属于哪一层协议？")).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole("button", { name: "编辑" })[0]!);

    // 列表里只有摘要，选项要靠详情带回来。
    await waitFor(() => {
      expect(api.loadQuestion).toHaveBeenCalledWith("30");
    });
    await waitFor(() => {
      expect(screen.getByDisplayValue("网络层")).toBeInTheDocument();
    });
  });

  it("保存题目后把待上传的附件传到服务端", async () => {
    api.createQuestion.mockResolvedValue({
      ...BANK_DETAIL.questions[0],
      id: "40",
      code: "Q-99",
      options: [],
      answer: [],
      keypoints: [],
      steps: [],
      attachments: [],
      analysis: "",
      reference: "",
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/banks/3?tab=questions"]}>
        <Routes>
          <Route path="/banks/:bankId" element={<BankWorkbenchPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("TCP 属于哪一层协议？")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /新建题目/ }));
    await user.type(screen.getByLabelText(/题目编号/), "Q-99");
    await user.type(screen.getByLabelText(/^题干/), "新建的题目");
    await user.click(screen.getAllByLabelText("设为正确答案")[0]!);

    // 附件先留在本地，保存题目时按题目 ID 传上去。
    const file = new File(["x"], "示意图.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(/题目附件/), file);
    await user.click(screen.getByRole("button", { name: "保存题目" }));

    await waitFor(() => {
      expect(api.uploadQuestionAttachment).toHaveBeenCalledTimes(1);
    });
    expect(api.uploadQuestionAttachment.mock.calls[0]![1]).toBe("40");
  });

  it("候选题批量发布走批量状态端点", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/banks/3?tab=candidates"]}>
        <Routes>
          <Route path="/banks/:bankId" element={<BankWorkbenchPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("简述 TCP 的三次握手。")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("checkbox", { name: /选择 Q-31/ }));
    await user.click(screen.getByRole("button", { name: /批量发布/ }));

    await waitFor(() => {
      expect(api.batchQuestionStatus).toHaveBeenCalledTimes(1);
    });
    expect(api.batchQuestionStatus.mock.calls[0]![0]).toEqual(["31"]);
    expect(api.batchQuestionStatus.mock.calls[0]![1]).toBe("published");
  });
});
