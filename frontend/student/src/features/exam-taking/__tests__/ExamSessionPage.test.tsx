import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ExamSessionPage } from "../ExamSessionPage";
import { useStudentStore } from "@/stores/studentStore";
import { useExamSessionStore } from "@/stores/examSessionStore";
import { useToastStore } from "@exam/shared";
import { resetCatalog, saveAttempt, useCatalog } from "@exam/shared/mock/catalog";

/** 进行中的试卷（种子数据 exam-net-mid）。 */
const EXAM_ID = "exam-net-mid";

/** 渲染答题页。 */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/exams/${EXAM_ID}`]}>
      <Routes>
        <Route path="/exams/:sessionId" element={<ExamSessionPage />} />
        <Route path="/exams/:sessionId/report" element={<div>成绩报告</div>} />
        <Route path="/exams" element={<div>考试安排</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ExamSessionPage · 考试答题页", () => {
  beforeEach(() => {
    resetCatalog();
    useToastStore.setState({ toasts: [] });
    useStudentStore.getState().setStudentId("2023120101");
    useExamSessionStore.getState().resetAll();
    // 屏蔽服务端时钟请求，测试里退回本机时间。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("渲染试卷名、答题卡与考试须知", async () => {
    const { container } = renderPage();

    await waitFor(() => {
      expect(container.querySelector(".exam-bar-title")?.textContent).toBe(
        "计算机网络期中考试",
      );
    });

    expect(screen.getByText("答题卡")).toBeInTheDocument();
    expect(screen.getByText("考试须知")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "交卷" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /标记/ })).toBeInTheDocument();
  });

  it("首题渲染题干与选项", async () => {
    const { container } = renderPage();

    await waitFor(() => {
      expect(container.querySelector(".q-stem")?.textContent?.trim().length).toBeGreaterThan(0);
    });
    expect(screen.getAllByRole("radio").length).toBeGreaterThanOrEqual(2);
    // 题头有题号、题型与分值。
    expect(container.querySelector(".q-index")?.textContent).toBe("第 1 题");
  });

  it("选择选项后已答计数递增", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();

    await waitFor(() => {
      expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);
    });

    // 选项的原生 input 是视觉隐藏的（1px、opacity 0、pointer-events none），
    // 真实用户点的是包住它的 label——测试也照这个路径走。
    const firstOption = screen.getAllByRole("radio")[0]!.closest("label")!;
    await user.click(firstOption);

    await waitFor(() => {
      const counter = container.querySelector(".answer-count");
      expect(counter?.textContent).toMatch(/^1\/\d+$/);
    });
    // 答题卡对应格子标记为已作答。
    expect(container.querySelectorAll(".sheet-cell.is-answered")).toHaveLength(1);
  });

  it("交卷弹出确认弹窗并显示未作答题数", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "交卷" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "交卷" }));

    const dialog = await screen.findByRole("dialog");
    // 标题与确认按钮同名，用标题元素与按钮分别断言。
    expect(dialog.querySelector(".dlg-title")?.textContent).toBe("确认交卷");
    expect(within(dialog).getByText(/仍有 \d+ 题未作答/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "继续作答" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "确认交卷" })).toBeInTheDocument();
  });

  it("切屏达到上限时强制交卷：落 attempt、记原因、跳成绩报告", () => {
    // 设计文档 FR-ANT-02「超限处置」：切屏次数达到上限即强制交卷。
    vi.useFakeTimers();
    try {
      renderPage();

      // 连切 3 次（每次隔开 500ms 去重窗口），上限默认 3 次。
      for (let i = 0; i < 3; i += 1) {
        act(() => {
          window.dispatchEvent(new Event("blur"));
          vi.advanceTimersByTime(600);
        });
      }

      expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(
        /切屏次数已达上限（3 次），已强制交卷/,
      );
      expect(useExamSessionStore.getState().forcedSubmitted).toBe(true);
      expect(useExamSessionStore.getState().forcedReason).toMatch(/切屏次数已达上限/);
      // 作答记录落库（强制交卷也要留下 attempt）。
      expect(useCatalog.getState().attempts[`${EXAM_ID}:2023120101`]).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("重考时 attemptNo 按已有记录的次数递增（第三次是 3，不是 2）", async () => {
    // 已有两次作答记录：本次是第 3 次。
    saveAttempt({
      examId: EXAM_ID,
      studentId: "2023120101",
      submittedAt: "2026-11-09T10:24:00.000Z",
      responses: {},
      score: 30,
      total: 100,
      pendingSubjective: false,
      variantLabel: "0101 号卷",
      attemptNo: 2,
      attempts: 2,
    });

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "交卷" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /交卷/ }));

    await waitFor(() => {
      expect(
        useCatalog.getState().attempts[`${EXAM_ID}:2023120101`]?.attemptNo,
      ).toBe(3);
    });
  });

  it("不在名单范围内的学生看到「考试不存在」", async () => {
    // 换一个不存在的学生。
    useStudentStore.getState().setStudentId("9999999999");
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("考试不存在")).toBeInTheDocument();
    });
  });
});
