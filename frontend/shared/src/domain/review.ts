/* ==========================================================================
   知行测评 · 阅卷与监考处置的领域类型
   --------------------------------------------------------------------------
   阅卷任务来自服务端：初判建议（suggestedScore）、要点命中（keypoints）、
   步骤命中（steps）都由服务端算，前端不重算——两套口径不一致时，
   教师看到的建议分和学生端看到的分数会对不上。

   监考处置是**按 attempt 维度**的：强制交卷要落到某一次作答上，
   所以候选人模型里必须带 attemptId。
   ========================================================================== */

/** 阅卷任务状态（后端存储值：`pending` / `in_review` / `reviewed`）。 */
export type ReviewTaskStatus = "pending" | "in_review" | "reviewed";

/** 阅卷任务。 */
export interface ReviewTask {
  id: string;
  /** 所属作答（监考处置也是按这个维度）。 */
  attemptId: string;
  /** 作答次序；重考不串号。 */
  attemptNo: number;
  /** 试卷名。 */
  examName: string;
  examSessionId: string | null;
  questionId: string;
  questionCode: string;
  /** 题型码（`short` / `comprehensive` …）。 */
  questionType: string;
  /** 综合题按步骤拆分时的步骤码。 */
  stepCode: string | null;
  /** 作答原文。 */
  answerText: string;
  /** 系统初判建议分。 */
  suggestedScore: number | null;
  /** 该题（步骤）的满分。 */
  maxScore: number;
  status: ReviewTaskStatus;
  statusLabel: string;
  /** 指派的阅卷人。 */
  assigneeId: string | null;
  /** 实际阅卷人。 */
  reviewerId: string | null;
  /** 最终分数。 */
  finalScore: number | null;
  /** 评语（学生可见）。 */
  comment: string;
  createdAt: string;
  reviewedAt: string | null;
  /** 答题者账号。 */
  studentUsername: string;
  /** 答题者姓名。 */
  studentDisplayName: string;
}

/** 评分要点的命中情况。 */
export interface ReviewKeypoint {
  text: string;
  hit: boolean;
}

/** 综合题步骤的命中情况。 */
export interface ReviewStep {
  code: string;
  prompt: string;
  score: number;
  hit: boolean;
}

/** 阅卷卷宗详情。 */
export interface ReviewTaskDetail {
  task: ReviewTask;
  /** 题干。 */
  stem: string;
  questionType: string;
  questionTypeLabel: string;
  /** 参考答案。 */
  referenceAnswer: string;
  /** 解析。 */
  analysis: string;
  keypoints: ReviewKeypoint[];
  steps: ReviewStep[];
  /** 命中的要点 / 步骤说明。 */
  hitItems: string[];
  /** 未命中的要点 / 步骤说明。 */
  missedItems: string[];
  /** 阅卷备注。 */
  notes: string[];
  studentUsername: string;
  studentDisplayName: string;
}

/** 阅卷任务计数。 */
export interface ReviewCounts {
  /** 待领取。 */
  pending: number;
  /** 阅卷中。 */
  inReview: number;
  /** 已阅完。 */
  reviewed: number;
  /** 分配给我的。 */
  mine: number;
}

/** 人工评分的结果。 */
export interface ReviewGradeResult {
  reviewTaskId: string;
  status: ReviewTaskStatus;
  statusLabel: string;
  finalScore: number;
  maxScore: number;
  comment: string;
  scoreResultStatus: string;
  scoreResultStatusLabel: string;
  /** 改分流水版本号。 */
  revision: number;
}

/** 批量采纳初判的逐条结果。 */
export interface BatchAdoptItem {
  taskId: string;
  status: ReviewTaskStatus;
  statusLabel: string;
  finalScore: number | null;
  /** 跳过的原因。 */
  message: string;
}

/** 批量采纳初判的结果。 */
export interface BatchAdoptResult {
  total: number;
  adopted: number;
  skipped: number;
  items: BatchAdoptItem[];
}

/** 监考处置类型（后端存储值：`warn` / `note` / `force_submit`）。 */
export type ProctorActionKind = "warn" | "note" | "force_submit";

/** 监考处置记录。 */
export interface ProctorActionEntry {
  id: string;
  /** 处置落到的那一次作答。 */
  attemptId: string;
  kind: ProctorActionKind;
  /** 下发给考生的内容。 */
  message: string;
  /** 处置原因（教师留痕）。 */
  reason: string;
  /** 操作人。 */
  operator: string;
  createdAt: string;
}
