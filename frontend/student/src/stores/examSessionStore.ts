/* ==========================================================================
   知行测评 · 考试会话状态机
   --------------------------------------------------------------------------
   对齐原型 student.js 的 examSession 语义，并叠加设计文档的生产化机制：

   1. **倒计时以绝对 deadlineAt 为准**——离开页面、后台标签页节流都不影响剩余时长。
   2. **切屏计数由服务端确认**——客户端只上报，不自行判定。
   3. 交卷后**最高分保留**（允许重考时），阅卷记录按 attempt 归属，重考不串号。
   4. **会话按「考试 × 答题者」归档并持久化**（原型 examSessions，键 examId:studentId），
      刷新后倒计时不重置——deadlineAt 是绝对时间，不会因为重新挂载而延长。

   作答的持久化与上行由 draftQueue（IndexedDB）+ SyncEngine 承担，
   本 store 只负责会话内状态。
   ========================================================================== */

import { create } from "zustand";
import { persist } from "zustand/middleware";
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

/**
 * 单场考试的会话快照。
 *
 * 与原型 store.state.examSessions[examId:studentId] 一一对应——
 * 归档后可持久化，刷新 / 切回时按快照恢复，倒计时不重置。
 */
export interface ExamSessionSnapshot {
  /** 试卷 ID。 */
  examId: string;
  /** 答题者 ID。 */
  studentId: string;
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
  /** 第几次作答（重考自增）。 */
  attemptNo: number;
  /** 切屏次数。 */
  focusLossCount: number;
  /** 切屏上限。 */
  maxFocusLoss: number;
  /** 是否已被强制交卷。 */
  forcedSubmitted: boolean;
  /** 强制交卷原因。 */
  forcedReason: string | null;
}

/** 会话归档键：考试 × 答题者。 */
export function examSessionKey(examId: string, studentId: string): string {
  return `${examId}:${studentId}`;
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
  /** 第几次作答（重考自增）。 */
  attemptNo: number;
  /** 切屏次数。 */
  focusLossCount: number;
  /** 切屏上限。 */
  maxFocusLoss: number;
  /** 是否已被强制交卷。 */
  forcedSubmitted: boolean;
  /** 强制交卷原因。 */
  forcedReason: string | null;
  /** 各场考试的会话归档（键 examId:studentId），持久化。 */
  sessions: Record<string, ExamSessionSnapshot>;

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
  /**
   * 重考：清空本次作答与计时，重新开始一次尝试。
   *
   * 与 `reset` 的区别是**保留**场次与题序，只把作答状态清零，
   * 否则重新进入同一场考试会命中「已交卷」的死路。
   */
  resetForRetake: (params: { examId: string; studentId: string; durationMin: number }) => void;
  /** 把当前会话写入归档（键 examId:studentId）。 */
  sync: () => void;
  /** 彻底清空：用于「清除本地数据」。 */
  resetAll: () => void;
}

/** 初始状态。 */
const initialState = {
  examId: null,
  studentId: null,
  qids: [],
  responses: {} as ExamResponses,
  flags: {} as Record<string, boolean>,
  current: 0,
  startedAt: null,
  deadlineAt: null,
  remainingSec: 0,
  submitted: false,
  submittedAt: null,
  attemptNo: 0,
  focusLossCount: 0,
  maxFocusLoss: 3,
  forcedSubmitted: false,
  forcedReason: null,
  sessions: {} as Record<string, ExamSessionSnapshot>,
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

export const useExamSessionStore = create<ExamSessionState>()(
  persist(
    (set, get) => ({
      ...initialState,

      init: ({ examId, studentId, qids, durationMin, maxFocusLoss }) => {
        const key = examSessionKey(examId, studentId);
        const prev = get().sessions[key];
        const now = Date.now();
        const limit = maxFocusLoss ?? get().maxFocusLoss;
        // 题序一致说明是同一场考试的会话——恢复它，倒计时不因刷新而重置。
        const samePaper = prev !== undefined && prev.qids.join(",") === qids.join(",");

        if (samePaper && prev) {
          const startedAt = prev.startedAt ?? new Date(now).toISOString();
          // deadlineAt 是绝对时间：没有就补上（重考后进入考试才开始计时）。
          const deadlineAt = prev.deadlineAt ?? now + durationMin * 60 * 1000;
          set({
            examId,
            studentId,
            qids,
            responses: prev.responses,
            flags: prev.flags,
            current: prev.current,
            startedAt,
            deadlineAt,
            remainingSec: Math.max(0, Math.ceil((deadlineAt - now) / 1000)),
            submitted: prev.submitted,
            submittedAt: prev.submittedAt,
            attemptNo: prev.attemptNo,
            focusLossCount: prev.focusLossCount,
            maxFocusLoss: limit,
            forcedSubmitted: prev.forcedSubmitted,
            forcedReason: prev.forcedReason,
          });
        } else {
          set({
            examId,
            studentId,
            qids,
            responses: {},
            flags: {},
            current: 0,
            startedAt: new Date(now).toISOString(),
            deadlineAt: now + durationMin * 60 * 1000,
            remainingSec: durationMin * 60,
            submitted: false,
            submittedAt: null,
            attemptNo: 0,
            focusLossCount: 0,
            maxFocusLoss: limit,
            forcedSubmitted: false,
            forcedReason: null,
          });
        }
        get().sync();
      },

      restore: (session) => {
        set((state) => ({ ...state, ...session }));
        get().sync();
      },

      setAnswer: (qid, payload) => {
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
        });
        get().sync();
      },

      clearAnswer: (qid) => {
        set((state) => {
          const responses = { ...state.responses };
          delete responses[qid];
          return { responses };
        });
        get().sync();
      },

      toggleFlag: (qid) => {
        set((state) => ({
          flags: { ...state.flags, [qid]: !state.flags[qid] },
        }));
        get().sync();
      },

      goto: (index) => {
        set((state) => ({
          current: Math.min(Math.max(0, index), Math.max(0, state.qids.length - 1)),
        }));
        get().sync();
      },

      gotoSlot: (slot) => {
        set({ current: Math.max(0, slot - 1) });
        get().sync();
      },

      tick: (now = Date.now()) => {
        set((state) => {
          if (state.deadlineAt === null || state.submitted) return state;
          const remaining = Math.max(0, Math.ceil((state.deadlineAt - now) / 1000));
          return { remainingSec: remaining };
        });
        get().sync();
      },

      setFocusLossCount: (count) => {
        set({ focusLossCount: count });
        get().sync();
      },

      markForcedSubmit: (reason) => {
        set({ submitted: true, forcedSubmitted: true, forcedReason: reason });
        get().sync();
      },

      markSubmitted: () => {
        set({ submitted: true, submittedAt: new Date().toISOString() });
        get().sync();
      },

      reset: () => {
        set({ ...initialState, sessions: get().sessions });
      },

      resetForRetake: ({ examId, studentId, durationMin }) => {
        const key = examSessionKey(examId, studentId);
        const prev = get().sessions[key];
        // 重考：清空作答 / 标记 / 计时，作答次序自增；成绩按最高分保留。
        const fresh: ExamSessionSnapshot = {
          examId,
          studentId,
          qids: prev?.qids ?? [],
          responses: {},
          flags: {},
          current: 0,
          startedAt: null,
          deadlineAt: null,
          remainingSec: durationMin * 60,
          submitted: false,
          submittedAt: null,
          attemptNo: (prev?.attemptNo ?? 0) + 1,
          focusLossCount: 0,
          maxFocusLoss: prev?.maxFocusLoss ?? get().maxFocusLoss,
          forcedSubmitted: false,
          forcedReason: null,
        };
        set((state) => ({ sessions: { ...state.sessions, [key]: fresh } }));
        // 当前激活的就是这一场时，平铺状态同步清零。
        const state = get();
        if (state.examId === examId && state.studentId === studentId) {
          set({
            responses: {},
            flags: {},
            current: 0,
            startedAt: null,
            deadlineAt: null,
            remainingSec: durationMin * 60,
            submitted: false,
            submittedAt: null,
            attemptNo: fresh.attemptNo,
            focusLossCount: 0,
            forcedSubmitted: false,
            forcedReason: null,
          });
        }
      },

      sync: () => {
        const state = get();
        if (!state.examId || !state.studentId) return;
        const key = examSessionKey(state.examId, state.studentId);
        const snapshot: ExamSessionSnapshot = {
          examId: state.examId,
          studentId: state.studentId,
          qids: state.qids,
          responses: state.responses,
          flags: state.flags,
          current: state.current,
          startedAt: state.startedAt,
          deadlineAt: state.deadlineAt,
          remainingSec: state.remainingSec,
          submitted: state.submitted,
          submittedAt: state.submittedAt,
          attemptNo: state.attemptNo,
          focusLossCount: state.focusLossCount,
          maxFocusLoss: state.maxFocusLoss,
          forcedSubmitted: state.forcedSubmitted,
          forcedReason: state.forcedReason,
        };
        set((prev) =>
          prev.sessions[key] === snapshot
            ? prev
            : { sessions: { ...prev.sessions, [key]: snapshot } },
        );
      },

      resetAll: () => set({ ...initialState }),
    }),
    {
      // 会话与作答数据落盘；令牌一律不落盘（见 shared/src/api/tokenStore.ts）。
      name: "zhixing.student.examSessions.v1",
    },
  ),
);

/** 统计已作答题数。 */
export function countAnswered(
  responses: ExamResponses,
  questions: Map<string, Question>,
): number {
  return Object.keys(responses).filter((qid) => isQuestionAnswered(qid, responses, questions)).length;
}
