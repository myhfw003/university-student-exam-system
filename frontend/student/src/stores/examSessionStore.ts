/* ==========================================================================
   知行测评 · 考试会话状态机
   --------------------------------------------------------------------------
   对齐原型 student.js 的 examSession 语义，并叠加设计文档的生产化机制：

   1. **倒计时以绝对 deadlineAt 为准**——离开页面、后台标签页节流都不影响剩余时长。
   2. **切屏计数由服务端确认**——客户端只上报，不自行判定。
   3. 交卷后**最高分保留**（允许重考时），阅卷记录按 attempt 归属，重考不串号。

   作答的持久化与上行由 draftQueue（IndexedDB）+ SyncEngine 承担，
   本 store 只负责会话内状态。
   ========================================================================== */

import { create } from "zustand";
import type { AnswerPayload } from "@exam/shared/domain/attempt";
import type { Question } from "@exam/shared/domain/types";

/** 考生作答内容。choice 存**卷面显示字母**。 */
export interface ExamResponses {
  [qid: string]: {
    choice?: string[];
    text?: string;
    steps?: Record<string, string>;
  };
}

/** 考试会话状态。 */
export interface ExamSessionState {
  /** 试卷 ID。 */
  examId: string | null;
  /** 答题者 ID。 */
  studentId: string | null;
  /** 卷面题目 ID 顺序。 */
  qids: string[];
  /** 作答内容。 */
  responses: ExamResponses;
  /** 标记「待检查」的题号。 */
  flags: Record<string, boolean>;
  /** 当前题下标（0 基）。 */
  current: number;
  /** 开始时间（ISO）。 */
  startedAt: string | null;
  /** 绝对截止时间（epoch ms）。 */
  deadlineAt: number | null;
  /** 剩余秒数。 */
  remainingSec: number;
  /** 是否已交卷。 */
  submitted: boolean;
  /** 交卷时间（ISO）。 */
  submittedAt: string | null;
  /** 服务端确认的切屏次数。 */
  focusLossCount: number;
  /** 切屏上限。 */
  maxFocusLoss: number;
  /** 是否已被强制交卷。 */
  forcedSubmitted: boolean;
  /** 强制交卷原因。 */
  forcedReason: string | null;

  /** 初始化会话。 */
  init: (params: {
    examId: string;
    studentId: string;
    qids: string[];
    durationMin: number;
    maxFocusLoss?: number;
  }) => void;
  /** 恢复已有会话。 */
  restore: (session: Partial<ExamSessionState>) => void;
  /** 写入答案。 */
  setAnswer: (qid: string, payload: AnswerPayload) => void;
  /** 清空某题答案。 */
  clearAnswer: (qid: string) => void;
  /** 切换标记。 */
  toggleFlag: (qid: string) => void;
  /** 跳转到指定下标。 */
  goto: (index: number) => void;
  /** 跳转到指定题号。 */
  gotoSlot: (slot: number) => void;
  /** 推进计时（每秒调用）。 */
  tick: (now?: number) => void;
  /** 设置服务端确认的切屏次数。 */
  setFocusLossCount: (count: number) => void;
  /** 标记强制交卷。 */
  markForcedSubmit: (reason: string) => void;
  /** 标记已交卷。 */
  markSubmitted: () => void;
  /** 重置会话（允许重考时）。 */
  reset: () => void;
  /** 彻底清空：用于「清除本地数据」。 */
  resetAll: () => void;
}

/** 初始状态。 */
const initialState = {
  examId: null,
  studentId: null,
  qids: [],
  responses: {},
  flags: {},
  current: 0,
  startedAt: null,
  deadlineAt: null,
  remainingSec: 0,
  submitted: false,
  submittedAt: null,
  focusLossCount: 0,
  maxFocusLoss: 3,
  forcedSubmitted: false,
  forcedReason: null,
};

/** 某题是否已作答（按题型分别判定）。 */
export function isQuestionAnswered(
  qid: string,
  responses: ExamResponses,
  questions: Map<string, Question>,
): boolean {
  const response = responses[qid];
  if (!response) return false;

  const type = questions.get(qid)?.type;
  if (type === "short") return (response.text ?? "").trim().length > 0;
  if (type === "comprehensive") {
    const steps = response.steps ?? {};
    return Object.values(steps).some((text) => text.trim().length > 0);
  }
  return (response.choice ?? []).length > 0;
}

export const useExamSessionStore = create<ExamSessionState>((set, get) => ({
  ...initialState,

  init: ({ examId, studentId, qids, durationMin, maxFocusLoss }) => {
    const now = Date.now();
    set({
      examId,
      studentId,
      qids,
      current: 0,
      startedAt: new Date(now).toISOString(),
      // 绝对截止时间：切标签页、后台节流都不影响剩余时长。
      deadlineAt: now + durationMin * 60 * 1000,
      remainingSec: durationMin * 60,
      submitted: false,
      submittedAt: null,
      forcedSubmitted: false,
      forcedReason: null,
      maxFocusLoss: maxFocusLoss ?? get().maxFocusLoss,
    });
  },

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
    set((state) => ({
      flags: { ...state.flags, [qid]: !state.flags[qid] },
    })),

  goto: (index) =>
    set((state) => ({
      current: Math.min(Math.max(0, index), Math.max(0, state.qids.length - 1)),
    })),

  gotoSlot: (slot) => set({ current: Math.max(0, slot - 1) }),

  tick: (now = Date.now()) =>
    set((state) => {
      if (state.deadlineAt === null || state.submitted) return state;
      const remaining = Math.max(0, Math.ceil((state.deadlineAt - now) / 1000));
      return { remainingSec: remaining };
    }),

  setFocusLossCount: (count) => set({ focusLossCount: count }),

  markForcedSubmit: (reason) =>
    set({ submitted: true, forcedSubmitted: true, forcedReason: reason }),

  markSubmitted: () => set({ submitted: true, submittedAt: new Date().toISOString() }),

  reset: () => set({ ...initialState }),

  resetAll: () => set({ ...initialState }),
}));

/** 统计已作答题数。 */
export function countAnswered(
  responses: ExamResponses,
  questions: Map<string, Question>,
): number {
  return Object.keys(responses).filter((qid) => isQuestionAnswered(qid, responses, questions)).length;
}
