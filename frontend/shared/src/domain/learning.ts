/* ==========================================================================
   知行测评 · 学习域类型
   --------------------------------------------------------------------------
   错题本与学生工作台：这两处的数据都由服务端算好，
   前端只负责呈现（不重算正确率、不重算错题分布）。
   ========================================================================== */

import type { QuestionType } from "./types";

/** 错题本里的一条。 */
export interface MistakeEntry {
  /** 题目 ID。 */
  questionId: string;
  questionCode: string;
  type: QuestionType;
  typeLabel: string;
  /** 题干。 */
  stem: string;
  /** 标签名（接口给的是名字，不是 ID）。 */
  tagNames: string[];
  /** 错了几次。 */
  wrongCount: number;
  /** 错因。 */
  reason: string;
  reasonLabel: string;
  /** 来源：考试 / 练习。 */
  sourceType: string;
  sourceTypeLabel: string;
  /** 最近一次做错的时间。 */
  lastWrongAt: string;
  /** 标记已掌握的时间；null = 还没掌握。 */
  resolvedAt: string | null;
  /** 来源那次作答的 ID。 */
  sourceAttemptId: string | null;
}

/** 单题重做的结果：服务端已经把单题练习与作答会话开好了。 */
export interface RedoMistake {
  /** 单题练习的开放单 ID（跳练习页用）。 */
  practiceAssignmentId: string;
  /** 作答会话 ID。 */
  attemptId: string;
  questionId: string;
  questionCode: string;
  questionType: string;
  /** 单题练习的标题。 */
  title: string;
  deadlineAt: string;
}

/** 进行中的考试。 */
export interface OngoingExam {
  /** 场次 ID。 */
  examSessionId: string;
  name: string;
  openAt: string;
  closeAt: string;
  /** 考生须知。 */
  note: string | null;
  /** 考生是否已经开始过。 */
  started: boolean;
}

/** 推荐练习。 */
export interface RecommendedPractice {
  id: string;
  title: string;
  /** 标签名。 */
  tagNames: string[];
}

/** 最近成绩里的一条（考试与练习都算）。 */
export interface RecentResult {
  attemptId: string;
  /** `exam` 或 `practice`。 */
  kind: string;
  name: string;
  /** 日期（YYYY-MM-DD）。 */
  date: string;
  score: number;
  total: number;
  status: string;
}

/** 成绩趋势上的一个点（按时间正序）。 */
export interface ScoreTrendPoint {
  date: string;
  score: number;
  total: number;
}

/** 错题分布的一个分组。 */
export interface MistakeDistribution {
  tagName: string;
  /** 分组中文名（领域 / 知识点 / 能力）。 */
  group: string;
  count: number;
}

/** 学生工作台汇总。 */
export interface DashboardSummary {
  /** 待完成的练习数。 */
  pendingPractices: number;
  /** 进行中的考试数。 */
  ongoingExams: number;
  /** 学期平均分（百分制）；null = 还没有成绩。 */
  termAverageScore: number | null;
  /** 待订正的错题数。 */
  pendingMistakes: number;
  ongoingExam: OngoingExam | null;
  recommendedPractices: RecommendedPractice[];
  recentResults: RecentResult[];
  scoreTrend: ScoreTrendPoint[];
  mistakeDistribution: MistakeDistribution[];
  generatedAt: string;
}
