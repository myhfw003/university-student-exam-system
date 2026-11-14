/* ==========================================================================
   练习会话的持久化与重置
   --------------------------------------------------------------------------
   1. 会话按「练习 × 答题者」归档，刷新后恢复同一份会话（作答不丢）。
   2. 重置练习时清掉成绩（原型 student.js:1793 delete practiceResults[key]），
      否则列表上仍显示旧分与「再练一次」。
   ========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";
import {
  practiceSessionKey,
  usePracticeSessionStore,
} from "@/stores/practiceSessionStore";
import { clearPracticeResult, savePracticeResult, useCatalog } from "@exam/shared/mock/catalog";

const PRACTICE_ID = "prac-ds-linear";
const STUDENT_ID = "2023120101";

describe("practiceSessionStore · 练习会话", () => {
  beforeEach(() => {
    usePracticeSessionStore.getState().resetAll();
  });

  it("同一份练习重新进入时恢复既有作答，而不是清空", () => {
    const store = usePracticeSessionStore.getState();
    store.init({ practiceId: PRACTICE_ID, studentId: STUDENT_ID, qids: ["q-d-01", "q-d-02"] });
    usePracticeSessionStore.getState().setAnswer("q-d-01", { selectedOptionKey: "A" });
    usePracticeSessionStore.getState().sync();

    // 重新进入同一份练习（题序一致）——作答要还在。
    usePracticeSessionStore.getState().init({
      practiceId: PRACTICE_ID,
      studentId: STUDENT_ID,
      qids: ["q-d-01", "q-d-02"],
    });

    const state = usePracticeSessionStore.getState();
    expect(state.responses["q-d-01"]?.choice).toEqual(["A"]);
  });

  it("重置练习后重新进入不会恢复旧作答", () => {
    const store = usePracticeSessionStore.getState();
    store.init({ practiceId: PRACTICE_ID, studentId: STUDENT_ID, qids: ["q-d-01"] });
    usePracticeSessionStore.getState().setAnswer("q-d-01", { selectedOptionKey: "A" });
    usePracticeSessionStore.getState().sync();

    // 重置（重新练习）：归档里的旧作答也要清掉。
    usePracticeSessionStore.getState().reset();
    usePracticeSessionStore.getState().init({
      practiceId: PRACTICE_ID,
      studentId: STUDENT_ID,
      qids: ["q-d-01"],
    });

    expect(usePracticeSessionStore.getState().responses["q-d-01"]).toBeUndefined();
  });

  it("不同答题者的会话互不干扰", () => {
    const store = usePracticeSessionStore.getState();
    store.init({ practiceId: PRACTICE_ID, studentId: STUDENT_ID, qids: ["q-d-01"] });
    usePracticeSessionStore.getState().setAnswer("q-d-01", { selectedOptionKey: "A" });
    usePracticeSessionStore.getState().sync();

    usePracticeSessionStore.getState().init({
      practiceId: PRACTICE_ID,
      studentId: "2023120102",
      qids: ["q-d-01"],
    });

    expect(usePracticeSessionStore.getState().responses["q-d-01"]).toBeUndefined();
  });

  it("归档键是「练习 × 答题者」", () => {
    expect(practiceSessionKey(PRACTICE_ID, STUDENT_ID)).toBe(`${PRACTICE_ID}:${STUDENT_ID}`);
  });

  it("重置练习会清掉成绩，列表回到「未开始」", () => {
    savePracticeResult({
      practiceId: PRACTICE_ID,
      studentId: STUDENT_ID,
      score: 20,
      total: 30,
      attempts: 1,
      submittedAt: new Date().toISOString(),
    });
    expect(useCatalog.getState().practiceResults[`${PRACTICE_ID}:${STUDENT_ID}`]).toBeTruthy();

    clearPracticeResult(PRACTICE_ID, STUDENT_ID);
    expect(useCatalog.getState().practiceResults[`${PRACTICE_ID}:${STUDENT_ID}`]).toBeUndefined();
  });
});
