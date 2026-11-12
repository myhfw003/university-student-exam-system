/* ==========================================================================
   知行测评 · 练习会话状态机
   --------------------------------------------------------------------------
   与考试会话的差异（对齐原型与设计文档）：
   1. **不计时**——练习不设倒计时，也不因超时强制交卷。
   2. **不限制切屏**——练习不启用防作弊计数。
   3. 可重复次数由练习配置的 `repeats` 决定（0 = 不限）。
   4. 反馈时机：`immediate`（每题作答后即时反馈）或 `after_submit`（提交后统一展示）。
   5. 错题可回流错题本（`mistakeReflow`）。

   练习同样走 draftQueue（IndexedDB）+ SyncEngine 的作答可靠性链路。
   ========================================================================== */

import { create } from "zustand";
import type { AnswerPayload } from "@exam/shared/domain/attempt";
import type { GradedPaper } from "@exam/shared/engine/scoring";
import type { Question } from "@exam/shared/domain/types";
import { isQuestionAnswered, type ExamResponses } from "./examSessionStore";

/** 练习会话状态。 */
export interface PracticeSessionState {
  /** 练习 ID。 */
  practiceId: string | null;
  /** 答题者 ID。 */
  studentId: string | null;
  /** 卷面题目 ID 顺序。 */
  qids: string[];
  /** 作答内容。 */
  responses: ExamResponses;
  /** 标记。 */
  flags: Record<string, boolean>;
  /** 当前题下标。 */
  current: number;
  /** 开始时间（ISO）。 */
  startedAt: string | null;
  /** 已用秒数（练习仅统计用时，不倒计时）。 */
  elapsedSec: number;
  /** 是否已提交。 */
  submitted: boolean;
  /** 提交时间（ISO）。 */
  submittedAt: string | null;
  /** 判分结果。 */
  result: GradedPaper | null;
  /** 已提交次数。 */
  attempts: number;

  /** 初始化会话。 */
  init: (params: { practiceId: string; studentId: string; qids: string[] }) => void;
  /** 恢复已有会话。 */
  restore: (session: Partial<PracticeSessionState>) => void;
  /** 写入答案。 */
  setAnswer: (qid: string, payload: AnswerPayload) => void;
  /** 清空某题答案。 */
  clearAnswer: (qid: string) => void;
  /** 切换标记。 */
  toggleFlag: (qid: string) => void;
  /** 跳转。 */
  goto: (index: number) => void;
  /** 累计用时。 */
  tick: () => void;
  /** 标记已提交。 */
  markSubmitted: (result: GradedPaper) => void;
  /** 重置（重新练习）：清空作答，保留练习身份与已提交次数。 */
  reset: () => void;
  /** 彻底清空：用于「清除本地数据」，连同已提交次数一并丢弃。 */
  resetAll: () => void;
}

const initialState = {
  practiceId: null,
  studentId: null,
  qids: [],
  responses: {},
  flags: {},
  current: 0,
  startedAt: null,
  elapsedSec: 0,
  submitted: false,
  submittedAt: null,
  result: null,
  attempts: 0,
};

export const usePracticeSessionStore = create<PracticeSessionState>((set) => ({
  ...initialState,

  init: ({ practiceId, studentId, qids }) =>
    set({
      practiceId,
      studentId,
      qids,
      current: 0,
      startedAt: new Date().toISOString(),
      elapsedSec: 0,
      submitted: false,
      submittedAt: null,
      result: null,
    }),

  restore: (session) => set((state) => ({ ...state, ...session })),

  setAnswer: (qid, payload) =>
    set((state) => {
      const previous = state.responses[qid];
      const merged: ExamResponses[string] = {
        ...(previous ?? {}),
      };
      if (payload.selectedOptionKey !== undefined) {
        merged.choice = payload.selectedOptionKey ? [payload.selectedOptionKey] : [];
      }
      if (payload.selectedOptionKeys !== undefined) {
        merged.choice = payload.selectedOptionKeys;
      }
      if (payload.text !== undefined) {
        merged.text = payload.text ?? "";
      }
      if (payload.steps !== undefined) {
        // 综合题：载荷用 { stepCode, text } 数组，会话里按步骤 ID 存文本。
        merged.steps = Object.fromEntries(payload.steps.map((s) => [s.stepCode, s.text]));
      }
      const next: ExamResponses = { ...state.responses, [qid]: merged };
      return { responses: next };
    }),

  clearAnswer: (qid) =>
    set((state) => {
      const responses = { ...state.responses };
      delete responses[qid];
      return { responses };
    }),

  toggleFlag: (qid) =>
    set((state) => ({ flags: { ...state.flags, [qid]: !state.flags[qid] } })),

  goto: (index) =>
    set((state) => ({
      current: Math.min(Math.max(0, index), Math.max(0, state.qids.length - 1)),
    })),

  tick: () => set((state) => ({ elapsedSec: state.elapsedSec + 1 })),

  markSubmitted: (result) =>
    set((state) => ({
      submitted: true,
      submittedAt: new Date().toISOString(),
      result,
      attempts: state.attempts + 1,
    })),

  reset: () =>
    set((state) => ({
      ...initialState,
      practiceId: state.practiceId,
      studentId: state.studentId,
      qids: state.qids,
      attempts: state.attempts,
    })),

  resetAll: () => set({ ...initialState }),
}));

/** 统计已作答题数。 */
export function countPracticeAnswered(
  responses: ExamResponses,
  questions: Map<string, Question>,
): number {
  return Object.keys(responses).filter((qid) => isQuestionAnswered(qid, responses, questions)).length;
}
