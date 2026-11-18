/* ==========================================================================
   知行测评 · 练习会话控制器
   --------------------------------------------------------------------------
   答题页只认这一个接口：mock 模式与 HTTP 模式各有一份实现，
   页面不感知当前走的是哪条数据通路（`usePracticeSession` 负责分派）。
   ========================================================================== */

import type { AttemptFeedback } from "@exam/shared/domain/attempt";
import type { GradedPaper } from "@exam/shared/engine/scoring";
import type { BuiltPaper, BuiltPaperItem } from "@exam/shared/engine/paper";
import type { Practice, Question } from "@exam/shared/domain/types";
import type { ExamResponses } from "@/stores/examSessionStore";

/** 练习会话控制器。 */
export interface PracticeSessionController {
  /** 练习。 */
  practice: Practice | null;
  /** 卷面。 */
  paper: BuiltPaper | null;
  /** 当前题位。 */
  current: BuiltPaperItem | null;
  /** 题目索引。 */
  questionMap: Map<string, Question>;
  /** 作答内容。 */
  responses: ExamResponses;
  /** 标记。 */
  flags: Record<string, boolean>;
  /** 已作答题数。 */
  answeredCount: number;
  /** 待订正题数（部分正确 + 错误）。 */
  wrongCount: number;
  /** 判分结果。 */
  result: GradedPaper | null;
  /** 是否已提交。 */
  submitted: boolean;
  /** 已用秒数。 */
  elapsedSec: number;
  /** 提交时间（ISO）；未提交为 null。 */
  submittedAt: string | null;
  /** 离线状态。 */
  offline: boolean;
  /** 待同步批次。 */
  pending: number;
  /** 是否正在上行。 */
  syncing: boolean;
  /** 剩余可提交次数；null = 不限。 */
  remainingAttempts: number | null;
  /**
   * 服务端给的即时反馈。
   * <para>mock 模式为 null——那一支在本地算，页面自己判。</para>
   */
  feedback: AttemptFeedback | null;
  /** 向服务端要一次即时反馈（HTTP 模式）。 */
  refreshFeedback: () => void;
  /** 选择选项。 */
  choose: (qid: string, keys: string[]) => void;
  /** 写简答文本。 */
  writeText: (qid: string, text: string) => void;
  /** 写综合题步骤文本。 */
  writeStep: (qid: string, stepId: string, text: string) => void;
  /** 切换标记。 */
  toggleFlag: (qid: string) => void;
  /** 跳转。 */
  goto: (index: number) => void;
  /** 提交。 */
  submit: () => { ok: boolean; message?: string };
  /** 重新练习。 */
  redo: () => { ok: boolean; message?: string };
}

