/* ==========================================================================
   知行测评 · 前端领域类型
   --------------------------------------------------------------------------
   ID 统一用字符串，与原型 mock 数据（docs/ui-design/shared/js/seed.js）一致：
     标签 t-dom-calc / 题目 q-m-01 / 题库 bank-calc-basic /
     试卷 exam-net-mid / 练习 prac-math-limit / 名单组 c2301 / 学号 2023120101

   与后端 long 型主键的映射在 API 边界完成，前端领域层不感知。

   字段口径以 docs/design/03-domain-model.md 为准；原型未覆盖的字段（组织维度
   标签、审计字段等）在此保留位置。
   ========================================================================== */

/** 题目类型。 */
export type QuestionType = "single" | "multi" | "judge" | "short" | "comprehensive";

/** 题目状态。 */
export type QuestionStatus = "draft" | "published" | "disabled";

/** 题目来源。 */
export type QuestionSource = "manual" | "import" | "ai";

/** 标签分组。组织维度只挂用户，题目只挂前四维。 */
export type TagGroup = "domain" | "knowledge_point" | "ability" | "difficulty";

/** 难度等级。 */
export type DifficultyLevel = 1 | 2 | 3;

/** 标签。 */
export interface Tag {
  id: string;
  /** 标签名称，同分组内唯一。 */
  name: string;
  /** 所属分组。 */
  group: TagGroup;
  /** 难度分组下才有：1 基础 / 2 中等 / 3 较难。 */
  level?: DifficultyLevel;
}

/** 题目选项。 */
export interface QuestionOption {
  key: string;
  text: string;
}

/** 简答题评分要点。 */
export interface QuestionKeypoint {
  text: string;
  /** 命中关键词；为空时用 text 自身。 */
  keywords: string[];
}

/** 综合题评分步骤。 */
export interface QuestionStep {
  id: string;
  /** 步骤题干。 */
  prompt: string;
  /** 参考答案。 */
  answer: string;
  keywords: string[];
  /** 步骤分值权重。 */
  score: number;
}

/** 题目配图。 */
export interface QuestionFigure {
  type: string;
}

/** 题目。 */
export interface Question {
  id: string;
  type: QuestionType;
  /** 默认分值。 */
  score: number;
  status: QuestionStatus;
  source: QuestionSource;
  /** 挂载的标签 ID，最多 5 个。 */
  tags: string[];
  /** 题干。 */
  stem: string;
  /** 客观题选项。 */
  options?: QuestionOption[];
  /** 正确答案的选项键。 */
  answer: string[];
  /** 解析。 */
  analysis: string;
  /** 参考答案（简答题）。 */
  reference?: string;
  /** 简答题评分要点。 */
  keypoints?: QuestionKeypoint[];
  /** 综合题评分步骤。 */
  steps?: QuestionStep[];
  /** 题目配图。 */
  figure?: QuestionFigure;
  /** 导入 / 生成批次 ID。 */
  batchId?: string;
}

/** 题库。 */
export interface Bank {
  id: string;
  name: string;
  desc: string;
  tags: string[];
  questionIds: string[];
}

/** 名单组（组织维度标签）。 */
export interface ClassGroup {
  id: string;
  name: string;
}

/** 学生。 */
export interface Student {
  id: string;
  name: string;
  /** 所属名单组。 */
  classId: string;
  enrollYear: number;
}

/** 卷型。 */
export type PaperMode = "standard" | "small" | "large";

/** 题序规则。 */
export type OrderRule = "type" | "manual";

/** 答案公布时机。 */
export type PublishAnswerPolicy = "after_close" | "after_submit" | "on_open";

/** 试卷 / 练习的卷面条目（配分口径的唯一来源）。 */
export interface PaperItem {
  qid: string;
  score: number;
}

/** 考试试卷。 */
export interface ExamPaper {
  id: string;
  name: string;
  /** 批次名称。 */
  batch: string;
  tags: string[];
  /** 时长（分钟）。 */
  durationMin: number;
  /** 目标总分。 */
  totalScore: number;
  /** 及格分。 */
  passScore: number;
  openAt: string;
  closeAt: string;
  status: "draft" | "ongoing" | "ended";
  published: boolean;
  /** 是否允许重考。 */
  allowRetake: boolean;
  publishAnswer: PublishAnswerPolicy;
  /** 名单组 ID 数组；空数组 = 全员开放。 */
  scope: string[];
  questionIds: string[];
  items: PaperItem[];
  orderRule: OrderRule;
  /** 卷型配置。 */
  plum: { mode: PaperMode };
  note: string;
}

/** 练习。 */
export interface Practice {
  id: string;
  name: string;
  tags: string[];
  questionIds: string[];
  items: PaperItem[];
  /** 建议时长（分钟），不强制计时。 */
  durationMin: number;
  totalScore: number;
  status: "draft" | "published";
  published: boolean;
  scope: string[];
  /** 最大提交次数，0 = 无限。 */
  repeats: number;
  /** 反馈时机。 */
  feedback: "after_submit" | "immediate";
  /** 错题是否回流错题本。 */
  mistakeReflow: boolean;
  orderRule: OrderRule;
  note: string;
}

/** 阅卷卷宗。 */
export interface ReviewItem {
  id: string;
  examId: string;
  studentId: string;
  qid: string;
  /** 综合题按步骤拆分时为步骤 ID。 */
  stepId: string | null;
  /** 作答次序；重考不串号。 */
  attempt: number;
  answerText: string;
  submittedAt: string;
  status: "pending" | "reviewed";
  teacherScore: number | null;
  comment: string;
}

/** 导入批次。 */
export interface ImportBatch {
  id: string;
  fileName: string;
  operator: string;
  createdAt: string;
  status: "parsed" | "adopted";
  rowCount: number;
  columns: string[];
  mapping: Record<string, string>;
  rows: ImportRow[];
  adoptedAt?: string;
  adoptedCount?: number;
}

/** 导入 / 生成的一行候选题。 */
export interface ImportRow {
  no: number;
  stem: string;
  type: QuestionType;
  score: number;
  options: QuestionOption[];
  answer: string[];
  analysis: string;
  tags: string[];
  valid: boolean;
}

/** 生成批次。 */
export interface GenerationBatch {
  id: string;
  operator: string;
  createdAt: string;
  status: "generated" | "adopted";
  count: number;
  type: QuestionType;
  difficulty: string;
  prompt: string;
  tagIds: string[];
  rows: ImportRow[];
  adoptedAt?: string;
  adoptedCount?: number;
}

/** 卷型模板。 */
export interface PaperTemplate {
  id: string;
  name: string;
  kind: "exam" | "practice";
  mode: PaperMode | "fixed";
  durationMin: number;
  passScore: number;
  items: PaperItem[];
}

/** 历史成绩记录。 */
export interface ScoreRecord {
  examId: string;
  studentId: string;
  name: string;
  date: string;
  score: number;
  total: number;
  status: "done" | "pending";
}

/** 错题。 */
export interface Mistake {
  qid: string;
  studentId: string;
  wrongCount: number;
  lastWrongAt: string;
  reason: string;
}

/* ==========================================================================
   考试场次与交付（Delivery）
   --------------------------------------------------------------------------
   场次由已发布试卷创建（FR-DLV-01）。状态机：
     scheduled → in_progress → closed，另有 cancelled。
   名单在发布时按组织标签**物化**为考生 ID 列表（FR-DLV-02）。
   ========================================================================== */

/** 场次状态。 */
export type ExamSessionStatus = "scheduled" | "in_progress" | "closed" | "cancelled";

/** 超限处置策略。 */
export type OnExceededPolicy = "warn" | "force_submit";

/** 防作弊策略（FR-ANT-02）。 */
export interface AntiCheatPolicy {
  /** 切屏上限；达到即按策略处置。 */
  maxFocusLoss: number;
  /** 超限处置。 */
  onExceeded: OnExceededPolicy;
  /** 是否要求全屏。 */
  requireFullscreen: boolean;
  /** 是否禁用复制粘贴。 */
  disableCopyPaste: boolean;
  /** 是否禁用右键菜单。 */
  disableContextMenu: boolean;
  /** 是否叠加姓名与账号水印。 */
  watermark: boolean;
  /** 心跳间隔（秒）。 */
  heartbeatIntervalSec: number;
  /** 超过该秒数未收到心跳判为断连。 */
  disconnectThresholdSec: number;
}

/** 考试场次。 */
export interface ExamSession {
  id: string;
  /** 场次名称。 */
  name: string;
  /** 来源试卷 ID（已发布）。 */
  paperId: string;
  status: ExamSessionStatus;
  /** 开考时间。 */
  openAt: string;
  /** 结束时间。 */
  closeAt: string;
  /** 作答时长（分钟）。 */
  durationMin: number;
  /** 名单来源：组织标签 ID 列表；空表示全员开放。 */
  scope: string[];
  /** 发布时物化的考生 ID 列表。 */
  roster: string[];
  /** 是否允许重考。 */
  allowRetake: boolean;
  /** 防作弊策略。 */
  policy: AntiCheatPolicy;
  /** 考生须知。 */
  note: string;
  /** 创建时间。 */
  createdAt: string;
}

/** 考生在监考视图中的状态（FR-ANT-04）。 */
export type CandidateStatus =
  | "not_started"
  | "answering"
  | "submitted"
  | "forced_submitted"
  | "disconnected";

/** 监考视图的考生条目。 */
export interface ProctorCandidate {
  sessionId: string;
  studentId: string;
  status: CandidateStatus;
  /** 切屏次数。 */
  focusLossCount: number;
  /** 断连次数。 */
  disconnectCount: number;
  /** 最后心跳时间。 */
  lastHeartbeatAt: string | null;
  /** 已答题数。 */
  answeredCount: number;
  /** 总题数。 */
  totalCount: number;
  /** 交卷时间。 */
  submittedAt: string | null;
  /** 强制交卷原因。 */
  forcedReason: string | null;
}

/** 监考处置类型（FR-ANT-05）。 */
export type ProctorActionKind = "warn" | "note" | "force_submit";

/** 监考处置记录。 */
export interface ProctorAction {
  id: string;
  sessionId: string;
  studentId: string;
  kind: ProctorActionKind;
  /** 处置原因（强制交卷必填）。 */
  reason: string;
  /** 操作人。 */
  operator: string;
  /** 操作时间。 */
  createdAt: string;
}

/* ==========================================================================
   用户与角色（IAM）
   --------------------------------------------------------------------------
   角色见 docs/design/01-requirements.md §2.1 权限矩阵。
   组织归属用**组织维度标签**表达，不存独立字段（FR-IAM-04）。
   ========================================================================== */

/** 内置角色。 */
export type UserRole =
  | "system_admin"
  | "content_admin"
  | "author_teacher"
  | "grader_teacher"
  | "student"
  | "general_user";

/** 用户状态。 */
export type UserStatus = "active" | "disabled";

/** 账号。 */
export interface AppUser {
  id: string;
  /** 登录账号（不限学号）。 */
  account: string;
  /** 姓名。 */
  name: string;
  /** 角色列表，权限取并集。 */
  roles: UserRole[];
  /** 组织维度标签 ID 列表；社会人士为空。 */
  orgTags: string[];
  status: UserStatus;
  /** 邮箱。 */
  email: string;
  /** 创建时间。 */
  createdAt: string;
  /** 最后登录时间。 */
  lastLoginAt: string | null;
}

/* ==========================================================================
   审计日志（Audit）
   --------------------------------------------------------------------------
   追加式写入，仅管理员可查（FR-IAM-07 / FR-AUD-01）。
   ========================================================================== */

/** 审计动作。 */
export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "user.update"
  | "user.role_changed"
  | "user.tag_changed"
  | "question.publish"
  | "question.disable"
  | "question.delete"
  | "paper.publish"
  | "paper.unpublish"
  | "session.publish"
  | "session.cancel"
  | "attempt.force_submit"
  | "grade.publish"
  | "grade.modify"
  | "data.import"
  | "blueprint.generate";

/** 审计日志条目。 */
export interface AuditLog {
  id: string;
  /** 发生时间。 */
  at: string;
  /** 操作人。 */
  operator: string;
  /** 动作。 */
  action: AuditAction;
  /** 目标对象类型。 */
  targetType: string;
  /** 目标对象 ID。 */
  targetId: string;
  /** 变更前后摘要。 */
  summary: string;
  /** 来源 IP。 */
  ip: string;
  /** 浏览器 UA。 */
  userAgent: string;
}
