/* ==========================================================================
   知行测评 · 作答会话状态（L1 内存缓冲）
   --------------------------------------------------------------------------
   对应 docs/design/06-frontend.md §4.1 第一层：作答立即反映到 UI，不依赖网络。

   约定：
   1. 选择器细粒度订阅（useStore(s => s.field)），避免整树重渲染。
   2. 答案载荷按题型归一：单选/判断存 selectedOptionKey，多选存去重排序数组，
      简答存 text，综合题存 steps。
   ========================================================================== */

import { create } from "zustand";
import type { AnswerPayload, QuestionType } from "@exam/shared/domain/attempt";

/** 题目在会话中的呈现信息。 */
export interface SessionQuestion {
  id: number;
  type: QuestionType;
  stem: string;
  score: number;
  options?: Array<{ key: string; text: string }>;
  steps?: Array<{ code: string; text: string }>;
}

/** 作答会话状态。 */
export interface AttemptState {
  /** 作答会话 ID。 */
  attemptId: number | null;
  /** 题目列表（卷面）。 */
  questions: SessionQuestion[];
  /** 当前题号（0 基下标）。 */
  currentIndex: number;
  /** 题号 → 答案载荷。 */
  answers: Record<number, AnswerPayload>;
  /** 标记「待检查」的题号。 */
  marked: number[];
  /** 已分配的下一个 clientSeq。 */
  clientSeq: number;
  /** 是否已提交。 */
  submitted: boolean;
  /** 是否有待上行批次。 */
  pendingCount: number;
  /** 是否离线。 */
  offline: boolean;

  /** 初始化会话。 */
  init: (attemptId: number, questions: SessionQuestion[]) => void;
  /** 设置当前题号下标。 */
  setCurrentIndex: (index: number) => void;
  /** 写入某题答案。 */
  setAnswer: (questionId: number, payload: AnswerPayload) => void;
  /** 清空某题答案。 */
  clearAnswer: (questionId: number) => void;
  /** 切换标记状态。 */
  toggleMarked: (questionId: number) => void;
  /** 推进 clientSeq。 */
  nextClientSeq: () => number;
  /** 设置待上行数量。 */
  setPendingCount: (count: number) => void;
  /** 设置离线状态。 */
  setOffline: (offline: boolean) => void;
  /** 标记已提交。 */
  markSubmitted: () => void;
  /** 重置。 */
  reset: () => void;
}

const initialState = {
  attemptId: null,
  questions: [],
  currentIndex: 0,
  answers: {},
  marked: [],
  clientSeq: 1,
  submitted: false,
  pendingCount: 0,
  offline: false,
};

export const useAttemptStore = create<AttemptState>((set, get) => ({
  ...initialState,

  init: (attemptId, questions) =>
    set((state) => ({
      attemptId,
      questions,
      currentIndex: 0,
      submitted: false,
      // 重置答案与标记，但保留 clientSeq（断点恢复时由草稿回填）
      answers: state.answers,
      marked: state.marked,
    })),

  setCurrentIndex: (index) =>
    set((state) => {
      const max = Math.max(0, state.questions.length - 1);
      return { currentIndex: Math.min(Math.max(0, index), max) };
    }),

  setAnswer: (questionId, payload) =>
    set((state) => ({ answers: { ...state.answers, [questionId]: payload } })),

  clearAnswer: (questionId) =>
    set((state) => {
      const answers = { ...state.answers };
      delete answers[questionId];
      return { answers };
    }),

  toggleMarked: (questionId) =>
    set((state) => ({
      marked: state.marked.includes(questionId)
        ? state.marked.filter((id) => id !== questionId)
        : [...state.marked, questionId],
    })),

  nextClientSeq: () => {
    const seq = get().clientSeq;
    set({ clientSeq: seq + 1 });
    return seq;
  },

  setPendingCount: (count) => set({ pendingCount: count }),

  setOffline: (offline) => set({ offline }),

  markSubmitted: () => set({ submitted: true }),

  reset: () => set({ ...initialState, answers: {}, marked: [] }),
}));

/* ==========================================================================
   答案载荷构造工具
   ========================================================================== */

/** 构造单选 / 判断答案。 */
export function singlePayload(optionKey: string): AnswerPayload {
  return { selectedOptionKey: optionKey };
}

/** 构造多选答案（去重并按键排序，保证同一组选项的载荷稳定）。 */
export function multiPayload(optionKeys: string[]): AnswerPayload {
  return { selectedOptionKeys: [...new Set(optionKeys)].sort() };
}

/** 构造简答答案。 */
export function shortPayload(text: string): AnswerPayload {
  return { text };
}

/** 构造综合题答案。 */
export function comprehensivePayload(steps: Array<{ stepCode: string; text: string }>): AnswerPayload {
  return { steps };
}

/** 读取某题已选项（统一入口，供答题卡与选项区共用）。 */
export function selectedKeysOf(payload: AnswerPayload | undefined): string[] {
  if (!payload) return [];
  if (payload.selectedOptionKey) return [payload.selectedOptionKey];
  return payload.selectedOptionKeys ?? [];
}
