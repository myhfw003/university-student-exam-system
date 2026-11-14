/* ==========================================================================
   知行测评 · 学生端单场成绩报告
   --------------------------------------------------------------------------
   覆盖三种情形：
     A. 有本次作答记录 → 客观/主观得分、题型得分、逐题明细
     B. 无记录但有历史成绩 → 试卷回顾
     C. 都没有 → 暂未参加该考试
   ========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ExamReportPage } from "../ExamReportPage";
import { useStudentStore } from "@/stores/studentStore";
import {
  difficultyLevels,
  getExam,
  getQuestion,
  resetCatalog,
  saveAttempt,
  useCatalog,
} from "@exam/shared/mock/catalog";
import { buildPaper } from "@exam/shared/engine/paper";

const STUDENT = "2023120101";
const OTHER_STUDENT = "2023120207";

/** 渲染报告页。 */
function renderReport(examId: string) {
  return render(
    <MemoryRouter initialEntries={[`/exams/${examId}/report`]}>
      <Routes>
        <Route path="/exams/:sessionId/report" element={<ExamReportPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** 生成一份「全对」的答卷：客观题选正确选项，主观题填参考答案。 */
function perfectResponses(examId: string, studentId: string) {
  const exam = getExam(examId);
  if (!exam) throw new Error("试卷不存在");
  const paper = buildPaper(exam, studentId, undefined, getQuestion, difficultyLevels());
  const responses: Record<string, { choice?: string[]; text?: string; steps?: Record<string, string> }> = {};

  for (const item of paper.items) {
    const q = item.question;
    if (q.type === "single" || q.type === "judge") {
      const key = q.answer[0] ?? "A";
      responses[q.id] = { choice: [item.fromOriginal[key] ?? key] };
    } else if (q.type === "multi") {
      responses[q.id] = { choice: q.answer.map((k) => item.fromOriginal[k] ?? k) };
    } else if (q.type === "short") {
      responses[q.id] = { text: (q.keypoints ?? []).map((kp) => kp.text).join("；") };
    } else {
      const steps: Record<string, string> = {};
      for (const st of q.steps ?? []) steps[st.id] = st.answer;
      responses[q.id] = { steps };
    }
  }
  return responses;
}

beforeEach(() => {
  resetCatalog();
  useStudentStore.getState().setStudentId(STUDENT);
});

describe("ExamReportPage · 单场成绩报告", () => {
  it("有作答记录时展示得分统计与逐题明细", () => {
    const examId = "exam-net-mid";
    saveAttempt({
      examId,
      studentId: STUDENT,
      submittedAt: "2026-11-09 10:24",
      responses: perfectResponses(examId, STUDENT),
      score: 92,
      total: 100,
      pendingSubjective: true,
      variantLabel: "0101 号卷",
      attemptNo: 1,
      attempts: 1,
    });

    renderReport(examId);

    expect(screen.getByRole("heading", { name: "计算机网络期中考试" })).toBeInTheDocument();
    expect(screen.getByText("客观题得分")).toBeInTheDocument();
    expect(screen.getByText("主观题得分")).toBeInTheDocument();
    expect(screen.getByText("当前总分")).toBeInTheDocument();
    expect(screen.getByText("题型得分")).toBeInTheDocument();
    expect(screen.getByText("逐题明细")).toBeInTheDocument();
  });

  it("副标题带答题者姓名与学号", () => {
    // 原型 student.js:1390：{批次} · 卷型：{label}（{short}） · {姓名} {学号}
    const examId = "exam-net-mid";
    saveAttempt({
      examId,
      studentId: STUDENT,
      submittedAt: "2026-11-09 10:24",
      responses: perfectResponses(examId, STUDENT),
      score: 92,
      total: 100,
      pendingSubjective: true,
      variantLabel: "0101 号卷",
      attemptNo: 1,
      attempts: 1,
    });

    renderReport(examId);

    const name =
      useCatalog.getState().students.find((s) => s.id === STUDENT)?.name ?? STUDENT;
    expect(screen.getByText(new RegExp(`${name} ${STUDENT}`))).toBeInTheDocument();
  });

  it("无作答记录但有历史成绩时展示试卷回顾", () => {
    // 种子成绩：高等数学期末考试 76 分。
    renderReport("exam-math-final");

    expect(screen.getByText("试卷回顾")).toBeInTheDocument();
    expect(screen.getByText("本卷得分")).toBeInTheDocument();
    expect(screen.queryByText("逐题明细")).not.toBeInTheDocument();
  });

  it("既无记录也无成绩时提示暂未参加", () => {
    useStudentStore.getState().setStudentId(OTHER_STUDENT);
    renderReport("exam-net-mid");

    expect(screen.getByText("暂未参加该考试")).toBeInTheDocument();
  });

  it("试卷不存在时提示报告不存在", () => {
    renderReport("exam-not-exist");
    expect(screen.getByText("报告不存在")).toBeInTheDocument();
  });

  it("答卷记录按答题者隔离", () => {
    const examId = "exam-net-mid";
    saveAttempt({
      examId,
      studentId: OTHER_STUDENT,
      submittedAt: "2026-11-09 10:24",
      responses: perfectResponses(examId, OTHER_STUDENT),
      score: 80,
      total: 100,
      pendingSubjective: false,
      variantLabel: "0207 号卷",
      attemptNo: 1,
      attempts: 1,
    });

    // 切回原答题者：看不到别人的记录，也没有该生的历史成绩。
    useStudentStore.getState().setStudentId(STUDENT);
    renderReport(examId);
    expect(screen.getByText("暂未参加该考试")).toBeInTheDocument();
    expect(useCatalog.getState().attempts).toHaveProperty("exam-net-mid:2023120207");
  });
});
