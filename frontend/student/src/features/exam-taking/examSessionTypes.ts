/* ==========================================================================
   知行测评 · 考试会话控制器
   --------------------------------------------------------------------------
   答题页只认这一个接口。mock 模式与 HTTP 模式各有一份实现，
   页面不感知当前走的是哪条数据通路（`useExamSession` 负责分派）。
   ========================================================================== */

import type { ExamPaper, Question } from "@exam/shared/domain/types";
import type { BuiltPaper, BuiltPaperItem } from "@exam/shared/engine/paper";

/** 会话为空时的原因。 */
export type SessionBlockReason = null | "not_found" | "already_submitted" | "ended" | "time_up";

/** 考试会话控制器。 */
export interface ExamSessionController {
  /** 试卷；不可见时为 null。 */
  exam: ExamPaper | null;
  /** 卷面。 */
  paper: BuiltPaper | null;
  /** 当前题位。 */
  current: BuiltPaperItem | null;
  /** 题目索引。 */
  questionMap: Map<string, Question>;
  /** 作答内容。 */
  responses: Record<string, { choice?: string[]; text?: string; steps?: Record<string, string> }>;
  /** 标记。 */
  flags: Record<string, boolean>;
  /** 已作答题数。 */
  answeredCount: number;
  /** 未作答题数。 */
  blankCount: number;
  /** 剩余秒数。 */
  remainingSec: number;
  /** 切屏次数（客户端上报，服务端确认前为本地计数）。 */
  focusLossCount: number;
  /** 切屏上限。 */
  maxFocusLoss: number;
  /** 是否离线。 */
  offline: boolean;
  /** 待同步批次数。 */
  pending: number;
  /** 是否正在上行。 */
  syncing: boolean;
  /** 是否已交卷。 */
  submitted: boolean;
  /** 交卷时间（ISO 串）。 */
  submittedAt: string | null;
  /** 交卷原因。 */
  submitReason: string | null;
  /** 会话被阻断的原因。 */
  blocked: SessionBlockReason;
  /** 选择选项。 */
  choose: (qid: string, keys: string[]) => void;
  /** 写简答文本。 */
  writeText: (qid: string, text: string) => void;
  /** 写综合题步骤文本。 */
  writeStep: (qid: string, stepId: string, text: string) => void;
  /** 切换标记。 */
  toggleFlag: (qid: string) => void;
  /** 跳转到指定下标。 */
  goto: (index: number) => void;
  /** 交卷（auto 为真时按「超时自动交卷」提示）。 */
  submit: (auto?: boolean) => void;
  /** 强制交卷（切屏超限）。 */
  forceSubmit: (reason: string) => void;
  /** 立即同步。 */
  flush: () => void;
}
