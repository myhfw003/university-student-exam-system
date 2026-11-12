import { beforeEach, describe, expect, it } from "vitest";
import type { Question } from "@exam/shared/domain/types";
import {
  countAnswered,
  isQuestionAnswered,
  useExamSessionStore,
} from "../examSessionStore";

const questions = new Map<string, Question>([
  ["q-single", { id: "q-single", type: "single", score: 5, status: "published", source: "manual", tags: [], stem: "单选", answer: ["A"], analysis: "" }],
  ["q-short", { id: "q-short", type: "short", score: 8, status: "published", source: "manual", tags: [], stem: "简答", answer: [], analysis: "" }],
  ["q-comp", { id: "q-comp", type: "comprehensive", score: 18, status: "published", source: "manual", tags: [], stem: "综合", answer: [], analysis: "" }],
]);

describe("examSessionStore · 考试会话状态机", () => {
  beforeEach(() => {
    useExamSessionStore.getState().resetAll();
  });

  it("初始化时建立绝对截止时间与初始剩余秒数", () => {
    const before = Date.now();
    useExamSessionStore.getState().init({
      examId: "exam-x",
      studentId: "2023120101",
      qids: ["q-single", "q-short"],
      durationMin: 90,
    });
    const state = useExamSessionStore.getState();

    expect(state.examId).toBe("exam-x");
    expect(state.remainingSec).toBe(5400);
    expect(state.deadlineAt).not.toBeNull();
    expect(state.deadlineAt!).toBeGreaterThanOrEqual(before + 90 * 60 * 1000);
    expect(state.submitted).toBe(false);
  });

  it("倒计时按绝对 deadlineAt 计算，不因页面挂起而走慢", () => {
    useExamSessionStore.getState().init({
      examId: "exam-x",
      studentId: "s",
      qids: ["q-single"],
      durationMin: 10,
    });
    const deadline = useExamSessionStore.getState().deadlineAt!;

    // 模拟 30 秒后：直接用绝对时间算，不依赖累减。
    useExamSessionStore.getState().tick(deadline - 30_000);
    expect(useExamSessionStore.getState().remainingSec).toBe(30);

    useExamSessionStore.getState().tick(deadline + 1_000);
    expect(useExamSessionStore.getState().remainingSec).toBe(0);
  });

  it("按题型分别判定已作答", () => {
    const responses = {
      "q-single": { choice: ["A"] },
      "q-short": { text: "  " },
      "q-comp": { steps: { s1: "内容", s2: "  " } },
    };
    expect(isQuestionAnswered("q-single", responses, questions)).toBe(true);
    expect(isQuestionAnswered("q-short", responses, questions)).toBe(false);
    expect(isQuestionAnswered("q-comp", responses, questions)).toBe(true);
    expect(isQuestionAnswered("q-missing", responses, questions)).toBe(false);
  });

  it("已作答题数只统计真正作答的题", () => {
    const responses = {
      "q-single": { choice: ["A"] },
      "q-short": { text: "作答" },
      "q-comp": { steps: {} },
    };
    expect(countAnswered(responses, questions)).toBe(2);
  });

  it("综合题步骤按步骤 ID 存文本", () => {
    const store = useExamSessionStore.getState();
    store.setAnswer("q-comp", {
      steps: [
        { stepCode: "s1", text: "第一步" },
        { stepCode: "s2", text: "第二步" },
      ],
    });
    expect(useExamSessionStore.getState().responses["q-comp"]?.steps).toEqual({
      s1: "第一步",
      s2: "第二步",
    });
  });

  it("标记可来回切换，跳转受题目数约束", () => {
    const store = useExamSessionStore.getState();
    store.init({ examId: "e", studentId: "s", qids: ["q-single", "q-short"], durationMin: 5 });

    useExamSessionStore.getState().toggleFlag("q-single");
    expect(useExamSessionStore.getState().flags["q-single"]).toBe(true);
    useExamSessionStore.getState().toggleFlag("q-single");
    expect(useExamSessionStore.getState().flags["q-single"]).toBe(false);

    useExamSessionStore.getState().goto(99);
    expect(useExamSessionStore.getState().current).toBe(1);
    useExamSessionStore.getState().goto(-5);
    expect(useExamSessionStore.getState().current).toBe(0);
  });

  it("强制交卷会记录原因", () => {
    useExamSessionStore.getState().markForcedSubmit("检测到多次切屏，系统已强制交卷。");
    const state = useExamSessionStore.getState();
    expect(state.submitted).toBe(true);
    expect(state.forcedSubmitted).toBe(true);
    expect(state.forcedReason).toContain("切屏");
  });
});
