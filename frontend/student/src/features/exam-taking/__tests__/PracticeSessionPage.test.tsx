/* ==========================================================================
   练习作答页的三个关键行为
   --------------------------------------------------------------------------
   1. 错题重做：/practice/single-{qid} 只练这一题（原先会落到「练习不存在」）
   2. 即时反馈：feedback = "immediate" 的练习作答后立刻给出正误判定
   3. 重考：重新进入已交卷的考试要能重开一次新的尝试
   ========================================================================== */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PracticeSessionPage } from "../PracticeSessionPage";
import { ExamSessionPage } from "../ExamSessionPage";
import { useStudentStore } from "@/stores/studentStore";
import { usePracticeSessionStore } from "@/stores/practiceSessionStore";
import { useToastStore, formatDateTime } from "@exam/shared";
import { useExamSessionStore } from "@/stores/examSessionStore";

/** 渲染练习作答页。 */
function renderPractice(assignmentId: string) {
  return render(
    <MemoryRouter initialEntries={[`/practice/${assignmentId}`]}>
      <Routes>
        <Route path="/practice/:assignmentId" element={<PracticeSessionPage />} />
        <Route path="/practice" element={<div>练习中心</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** 渲染考试答题页（含成绩报告路由）。 */
function renderExam(sessionId: string) {
  return render(
    <MemoryRouter initialEntries={[`/exams/${sessionId}`]}>
      <Routes>
        <Route path="/exams/:sessionId" element={<ExamSessionPage />} />
        <Route path="/exams/:sessionId/report" element={<div>成绩报告</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PracticeSessionPage · 练习作答页", () => {
  beforeEach(() => {
    useStudentStore.getState().setStudentId("2023120101");
    usePracticeSessionStore.getState().resetAll();
    useExamSessionStore.getState().resetAll();
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

  it("错题重做：single- 前缀能打开单题练习，而不是「练习不存在」", async () => {
    renderPractice("single-q-m-05");
    // 原实现会落到空态「练习不存在」。
    await waitFor(() => {
      expect(screen.queryByText("练习不存在")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/错题重做/)).toBeInTheDocument();
    // 题面渲染出来（q-m-05 是多选题：下列级数中绝对收敛的有）。
    expect((await screen.findAllByText(/绝对收敛/)).length).toBeGreaterThan(0);
  });

  it("刷新后会话已提交但没带结果时，按作答重算出结果视图", async () => {
    // 模拟旧版本落盘的会话快照：有提交标记，没有结果字段。
    usePracticeSessionStore.setState({
      practiceId: "prac-ds-linear",
      studentId: "2023120101",
      submitted: true,
      result: null,
      responses: {},
    });

    renderPractice("prac-ds-linear");

    // 原本会落到空白练习卷；重算后应直接给出逐题解析。
    await waitFor(() => {
      expect(screen.getByText("逐题解析")).toBeInTheDocument();
    });
    expect(screen.getByText("本次得分")).toBeInTheDocument();
  });

  it("结果视图的「提交于」取会话的提交时间，不是当前时间", async () => {
    // 原型 student.js:879：提交于 fmt.dateTime(session.submittedAt)
    const submittedAt = "2020-01-02T03:04:00.000Z";
    usePracticeSessionStore.setState({
      practiceId: "prac-ds-linear",
      studentId: "2023120101",
      submitted: true,
      submittedAt,
      result: {
        objective: { score: 5, max: 5 },
        subjective: { score: 0, max: 0, pending: 0 },
        total: 5,
        totalMax: 5,
        details: [],
      },
    });

    renderPractice("prac-ds-linear");

    await waitFor(() => {
      expect(screen.getByText("逐题解析")).toBeInTheDocument();
    });
    expect(
      screen.getByText(`提交于 ${formatDateTime(submittedAt)} · 用时 00:00`),
    ).toBeInTheDocument();
  });

  it("提交次数用完时用 toast 报错，不是常驻提示条", async () => {
    // 原型 student.js:1629：EX.toast("「…」最多提交 N 次，已用完", "error")
    // prac-net-tp 的 repeats = 3。
    const store = usePracticeSessionStore.getState();
    store.init({
      practiceId: "prac-net-tp",
      studentId: "2023120101",
      qids: ["q-n-01"],
    });
    usePracticeSessionStore.setState({ attempts: 3 });

    renderPractice("prac-net-tp");
    await screen.findByRole("button", { name: "提交练习" });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "提交练习" }));

    await waitFor(() => {
      expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(
        /最多提交 3 次，已用完/,
      );
    });
    // 不是常驻提示条。
    expect(screen.queryByText("无法提交")).not.toBeInTheDocument();
  });

  it("即时反馈：immediate 模式的练习作答后立刻给出判定", async () => {
    // prac-ds-linear 的反馈时机是 immediate（seed 里如此配置）。
    renderPractice("prac-ds-linear");
    await screen.findByText("数据结构 · 线性结构与算法复杂度专项");

    // 第一题是单选：点一个选项即应出现即时反馈。
    // 选项的原生 input 是视觉隐藏的，真实用户点的是包住它的 label。
    const user = userEvent.setup();
    const radios = await screen.findAllByRole("radio");
    await user.click(radios[0]!.closest("label")!);

    await waitFor(() => {
      expect(screen.getByText(/回答正确|回答错误|部分正确/)).toBeInTheDocument();
    });
  });
});

describe("ExamSessionPage · 超时与重考", () => {
  beforeEach(() => {
    useStudentStore.getState().setStudentId("2023120101");
    useExamSessionStore.getState().resetAll();
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

  it("倒计时归零自动交卷并跳到成绩报告", async () => {
    const { container } = renderExam("exam-net-mid");
    await waitFor(() => {
      expect(container.querySelector(".exam-bar-title")?.textContent).toBe("计算机网络期中考试");
    });

    // 会话已初始化（deadlineAt 有值）后把剩余时间压到 0。
    act(() => {
      useExamSessionStore.setState({ deadlineAt: Date.now() - 1000, remainingSec: 0 });
    });

    await waitFor(() => {
      expect(screen.getByText("成绩报告")).toBeInTheDocument();
    });
  });
});
