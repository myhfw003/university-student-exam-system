/* ==========================================================================
   管理端阅卷中心 · HTTP 模式
   --------------------------------------------------------------------------
   断言的是页面上真正能看到的东西：队列条目、卷宗细节、服务端给的初判建议，
   以及保存评分时发出去的请求。
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/** 被测的 API 函数。 */
const api = {
  loadReviewTasks: vi.fn(),
  loadReviewCounts: vi.fn(),
  loadReviewTaskDetail: vi.fn(),
  gradeReviewTask: vi.fn(),
  batchAdoptReviewTasks: vi.fn(),
  claimReviewTask: vi.fn(),
  assignReviewTask: vi.fn(),
  loadReviewTaskNeighbors: vi.fn(),
  loadUserPage: vi.fn(),
};

vi.mock("@exam/shared/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBackendEnabled: () => true,
  ...api,
}));

const { ReviewCenterPage } = await import("../ReviewCenterPage");

/** 后端阅卷任务。 */
const TASK = {
  id: "7",
  attemptId: "9001",
  attemptNo: 1,
  examName: "计算机网络期中考试",
  examSessionId: "12",
  questionId: "30",
  questionCode: "Q-30",
  questionType: "short",
  stepCode: null,
  answerText: "客户端先发 SYN，服务端回 SYN+ACK，客户端再回 ACK。",
  suggestedScore: 6.5,
  maxScore: 10,
  status: "pending",
  statusLabel: "待领取",
  assigneeId: null,
  reviewerId: null,
  finalScore: null,
  comment: "",
  createdAt: "2026-11-18T08:00:00Z",
  reviewedAt: null,
  studentUsername: "e2e-student",
  studentDisplayName: "端到端学生",
};

/** 后端卷宗详情。 */
const DETAIL = {
  task: TASK,
  stem: "简述 TCP 的三次握手过程。",
  questionType: "short",
  questionTypeLabel: "简答题",
  referenceAnswer: "SYN → SYN+ACK → ACK。",
  analysis: "两次握手无法确认客户端收到响应。",
  keypoints: [
    { text: "客户端发送 SYN", hit: true },
    { text: "服务端回复 SYN+ACK", hit: false },
  ],
  steps: [],
  hitItems: ["客户端发送 SYN"],
  missedItems: ["服务端回复 SYN+ACK"],
  notes: [],
  studentUsername: "e2e-student",
  studentDisplayName: "端到端学生",
};

describe("管理端阅卷中心 · HTTP 模式", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.loadReviewTasks.mockResolvedValue({ items: [TASK], total: 1 });
    api.loadReviewCounts.mockResolvedValue({ pending: 3, inReview: 1, reviewed: 2, mine: 1 });
    api.loadReviewTaskDetail.mockResolvedValue(DETAIL);
    api.gradeReviewTask.mockResolvedValue({
      reviewTaskId: "7",
      status: "reviewed",
      statusLabel: "已阅完",
      finalScore: 7,
      maxScore: 10,
      comment: "要点都提到了。",
      scoreResultStatus: "suggested",
      scoreResultStatusLabel: "待确认",
      revision: 1,
    });
    api.batchAdoptReviewTasks.mockResolvedValue({
      total: 1,
      adopted: 1,
      skipped: 0,
      items: [],
    });
    // 候选阅卷人：教师可指派，学生不在候选里。
    api.loadUserPage.mockResolvedValue({
      items: [
        { id: "101", username: "s101", displayName: "林知遥", status: "active", roles: ["student"] },
        {
          id: "201",
          username: "t201",
          displayName: "周慕青",
          status: "active",
          roles: ["grader_teacher"],
        },
      ],
      total: 2,
    });
    api.assignReviewTask.mockResolvedValue({ ...TASK, assigneeId: "201" });
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <Routes>
          <Route path="*" element={<ReviewCenterPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("队列显示服务端条目与计数", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("端到端学生")).toBeInTheDocument();
    });
    // 队列行里考试名与题型在同一行（文本被拆开），按片段找。
    expect(screen.getByText(/计算机网络期中考试/)).toBeInTheDocument();
    // 计数来自服务端。
    expect(screen.getByText(/待阅卷 3/)).toBeInTheDocument();
  });

  it("卷宗细节按服务端给的初判渲染", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("简述 TCP 的三次握手过程。")).toBeInTheDocument();
    });

    expect(screen.getByText("SYN → SYN+ACK → ACK。")).toBeInTheDocument();
    // 要点命中情况来自服务端。
    expect(screen.getByText("评分要点命中")).toBeInTheDocument();
    expect(screen.getByText("客户端发送 SYN")).toBeInTheDocument();
    expect(screen.getByText(/系统初判 6.5/)).toBeInTheDocument();
    // 作答原文。
    expect(screen.getByText(/客户端先发 SYN/)).toBeInTheDocument();
  });

  it("保存评分把分数与评语交给服务端", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("分数")).toBeInTheDocument();
    });

    // 直接点分数档位（和页面上教师点的操作一致）。
    await user.click(screen.getByRole("button", { name: "7" }));
    await user.type(screen.getByLabelText("评语"), "要点都提到了。");
    await user.click(screen.getByRole("button", { name: "保存评分" }));

    await waitFor(() => {
      expect(api.gradeReviewTask).toHaveBeenCalledTimes(1);
    });
    const [id, payload] = api.gradeReviewTask.mock.calls[0]!;
    expect(id).toBe("7");
    expect(payload.score).toBe(7);
    expect(payload.comment).toBe("要点都提到了。");
  });

  it("批量采纳先二次确认，再交给服务端", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "批量采纳初判建议" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "批量采纳初判建议" }));
    // 二次确认之前不发请求。
    expect(api.batchAdoptReviewTasks).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "批量采纳" }));
    await waitFor(() => {
      expect(api.batchAdoptReviewTasks).toHaveBeenCalledTimes(1);
    });
  });

  it("领取任务把卷宗先到先得地占下来", async () => {
    const user = userEvent.setup();
    api.claimReviewTask.mockResolvedValue({
      ...TASK,
      status: "in_review",
      statusLabel: "阅卷中",
      reviewerId: "1",
      assigneeId: "1",
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "领取任务" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "领取任务" }));

    await waitFor(() => {
      expect(api.claimReviewTask).toHaveBeenCalledTimes(1);
    });
    expect(api.claimReviewTask.mock.calls[0]).toEqual(["7"]);
  });

  it("能指派阅卷人，候选里只有教师", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "指派阅卷人" })).toBeInTheDocument();
    });
    // 还没指派。
    expect(screen.getByText("未指派")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "指派阅卷人" }));

    // 候选：教师可选；学生不是阅卷候选。
    const radio = await screen.findByRole("radio", { name: /周慕青/ });
    expect(screen.queryByRole("radio", { name: /林知遥/ })).not.toBeInTheDocument();

    await user.click(radio);
    await user.click(screen.getByRole("button", { name: "确认指派" }));

    await waitFor(() => {
      expect(api.assignReviewTask).toHaveBeenCalledTimes(1);
    });
    // 指派的是「哪份卷宗」与「给谁」。
    expect(api.assignReviewTask.mock.calls[0]).toEqual(["7", "201"]);
  });
});
