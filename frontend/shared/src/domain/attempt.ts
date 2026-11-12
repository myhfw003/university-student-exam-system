/* ==========================================================================
   知行测评 · 作答域类型
   --------------------------------------------------------------------------
   与 docs/design/03-domain-model.md §5.3–5.7 的领域模型对齐。
   前端只依赖这些结构，不直接接触后端 DTO 细节。
   ========================================================================== */

/** 题目类型。 */
export type QuestionType = "single" | "multi" | "judge" | "short" | "comprehensive";

/** 题目状态。 */
export type QuestionStatus = "draft" | "published" | "disabled";

/** 题目来源。 */
export type QuestionSource = "manual" | "import" | "generated";

/** 标签分组（五维）。组织维度只挂用户，题目只挂前四维。 */
export type TagGroup = "domain" | "knowledge_point" | "ability" | "difficulty" | "organization";

/** 题目选项。 */
export interface QuestionOption {
  key: string;
  text: string;
}

/** 简答题评分要点。 */
export interface QuestionKeypoint {
  code: string;
  text: string;
  score?: number;
}

/** 综合题评分步骤。 */
export interface QuestionStep {
  code: string;
  text: string;
  score?: number;
}

/** 题目。 */
export interface Question {
  id: string;
  code: string;
  type: QuestionType;
  stem: string;
  defaultScore: number;
  status: QuestionStatus;
  source: QuestionSource;
  analysis?: string | null;
  referenceAnswer?: string | null;
  tagIds: string[];
  difficultyTagId: string;
  options?: QuestionOption[];
  keypoints?: QuestionKeypoint[];
  steps?: QuestionStep[];
}

/**
 * 答案载荷值对象。按题型结构不同：
 * - single / judge：`selectedOptionKey`（单值）
 * - multi：`selectedOptionKeys`（排序后的去重数组）
 * - short：`text`
 * - comprehensive：`steps[]`（每项 stepCode + text）
 */
export interface AnswerPayload {
  selectedOptionKey?: string | null;
  selectedOptionKeys?: string[];
  text?: string | null;
  steps?: Array<{ stepCode: string; text: string }>;
}

/** 答案载荷是否为空（未作答）。 */
export function isPayloadEmpty(payload: AnswerPayload | null | undefined): boolean {
  if (!payload) return true;
  if (payload.selectedOptionKey) return false;
  if (payload.selectedOptionKeys && payload.selectedOptionKeys.length > 0) return false;
  if (payload.text && payload.text.trim().length > 0) return false;
  if (payload.steps && payload.steps.some((s) => s.text.trim().length > 0)) return false;
  return true;
}

/** 作答会话状态。 */
export type AttemptStatus = "not_started" | "in_progress" | "submitted" | "graded";

/** 交卷原因。 */
export type SubmitReason = "manual" | "time_up" | "proctor_force" | "admin_force";

/**
 * 焦点事件类型。`isFocusLoss` 判定哪些类型计入切屏计数。
 */
export type FocusEventType =
  | "window_blur"
  | "page_hidden"
  | "fullscreen_exit"
  | "copy_attempt"
  | "paste_attempt"
  | "context_menu";

/** 计入切屏计数的事件类型。 */
const FOCUS_LOSS_TYPES: ReadonlySet<FocusEventType> = new Set<FocusEventType>([
  "window_blur",
  "page_hidden",
  "fullscreen_exit",
]);

/** 是否计入切屏计数。 */
export function isFocusLoss(type: FocusEventType): boolean {
  return FOCUS_LOSS_TYPES.has(type);
}

/** 上行答案批次中的一道题。 */
export interface AnswerBatchItem {
  questionId: string;
  payload: AnswerPayload;
}

/**
 * 答案上行批次。
 *
 * `clientSeq` 在批次创建时分配并持久化到 IndexedDB，重放时保持不变——
 * 这是幂等的关键：重放同一批不会重复计数，也不会丢。
 */
export interface AnswerBatch {
  /** 作答会话 ID（字符串，与原型一致）。 */
  attemptId: string;
  clientSeq: number;
  items: AnswerBatchItem[];
  createdAt: string;
}
