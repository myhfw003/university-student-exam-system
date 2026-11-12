import { beforeEach, describe, expect, it } from "vitest";
import { usePracticeSessionStore } from "../practiceSessionStore";

describe("practiceSessionStore · 练习会话状态机", () => {
  beforeEach(() => {
    usePracticeSessionStore.getState().resetAll();
  });

  it("练习不设倒计时，只累计用时", () => {
    usePracticeSessionStore.getState().init({
      practiceId: "prac-x",
      studentId: "s",
      qids: ["q-1", "q-2"],
    });
    // 练习会话根本没有「截止时间」这个概念——只有累计用时。
    const state = usePracticeSessionStore.getState();
    expect("deadlineAt" in state).toBe(false);
    expect(state.elapsedSec).toBe(0);

    usePracticeSessionStore.getState().tick();
    usePracticeSessionStore.getState().tick();
    expect(usePracticeSessionStore.getState().elapsedSec).toBe(2);
  });

  it("提交后累计次数并记录结果", () => {
    usePracticeSessionStore.getState().init({
      practiceId: "prac-x",
      studentId: "s",
      qids: ["q-1"],
    });
    const graded = {
      objective: { score: 5, max: 5 },
      subjective: { score: 0, max: 0, pending: 0 },
      total: 5,
      totalMax: 5,
      details: [],
    };
    usePracticeSessionStore.getState().markSubmitted(graded);
    const state = usePracticeSessionStore.getState();
    expect(state.submitted).toBe(true);
    expect(state.attempts).toBe(1);
    expect(state.result?.total).toBe(5);
  });

  it("重新练习清空作答但保留已提交次数", () => {
    usePracticeSessionStore.getState().init({
      practiceId: "prac-x",
      studentId: "s",
      qids: ["q-1"],
    });
    usePracticeSessionStore.getState().setAnswer("q-1", { selectedOptionKey: "A" });
    usePracticeSessionStore.getState().markSubmitted({
      objective: { score: 0, max: 0 },
      subjective: { score: 0, max: 0, pending: 0 },
      total: 0,
      totalMax: 0,
      details: [],
    });

    // 「重新练习」用的是 reset：清空作答但保留已提交次数。
    usePracticeSessionStore.getState().reset();
    const state = usePracticeSessionStore.getState();
    expect(state.responses["q-1"]).toBeUndefined();
    expect(state.submitted).toBe(false);
    expect(state.attempts).toBe(1);
  });
});
