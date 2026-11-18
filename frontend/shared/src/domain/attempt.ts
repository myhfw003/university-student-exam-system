/* ==========================================================================
   知行测评 · 作答域类型
   --------------------------------------------------------------------------
   与 docs/design/03-domain-model.md §5.3–5.7 的领域模型对齐。
   前端只依赖这些结构，不直接接触后端 DTO 细节。
   ========================================================================== */

import type { QuestionType } from "./types";

/**
 * 题目类型。
 *
 * 内容域的类型统一在 `domain/types.ts` 定义，本模块只转出，
 * 避免同一个概念存在两套互不兼容的形状。
 */
export type { QuestionType } from "./types";

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

/**
 * 作答会话状态。
 *
 * 与 docs/design/03-domain-model.md §5.3 的状态机一致：
 * NotStarted → InProgress → Submitted / AutoSubmitted / ForceSubmitted，
 * 另有 Abandoned（超时未交被清理）。
 */
export type AttemptStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "auto_submitted"
  | "force_submitted"
  | "abandoned";

/**
 * 交卷原因。
 *
 * 与 §5.3 的 SubmitReason 一一对应：Manual / TimeUp / ProctorForce /
 * AdminForce / NetworkTimeout。
 */
export type SubmitReason =
  | "manual"
  | "time_up"
  | "proctor_force"
  | "admin_force"
  | "network_timeout";

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

/* ==========================================================================
   服务端下发的考生卷面
   --------------------------------------------------------------------------
   HTTP 模式下卷面来自服务端：选项已按该考生的置换顺序排列，
   但每个选项的 `key` 仍是**原题键**——服务端判分按原题键比较，
   前端要按显示位置重新编号成 A/B/C 给考生看。

   卷面里的题目**不含正确答案、解析与参考答案**：考试进行中下发这些等于泄题。
   ========================================================================== */

/** 卷面里的一个选项。`key` 是原题键，不是显示字母。 */
export interface SurfaceOption {
  key: string;
  text: string;
}

/** 综合题的一个作答步骤（不含参考答案与关键词）。 */
export interface SurfaceStep {
  code: string;
  prompt: string;
  score: number;
}

/** 卷面里的附件引用。 */
export interface SurfaceAttachment {
  objectKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

/** 考生卷面里的一道题。 */
export interface SurfaceQuestion {
  id: string;
  type: QuestionType;
  stem: string;
  score: number;
  /** 选项：按该考生的卷面顺序排列；`key` 是原题键。 */
  options: SurfaceOption[];
  /** 知识标签 ID（难度标签不在其中）。 */
  tagIds: string[];
  /** 难度标签 ID。 */
  difficultyTagId: string;
  /** 难度名。 */
  difficulty: string;
  /** 所属大题标题。 */
  sectionTitle: string | null;
  /** 综合题的作答步骤。 */
  steps: SurfaceStep[];
  /** 附件引用。 */
  attachments: SurfaceAttachment[];
}

/** 考试规则（服务端下发，作答期间生效）。 */
export interface AttemptRules {
  /** 切屏上限；null 表示不限制。 */
  maxFocusLoss: number | null;
  /** 切屏超限的处置方式。 */
  onMaxFocusLoss: string;
  requireFullScreen: boolean;
  blockCopyPaste: boolean;
  blockContextMenu: boolean;
  showWatermark: boolean;
  enableHeartbeatCheck: boolean;
  heartbeatIntervalSeconds: number;
  heartbeatTimeoutSeconds: number;
  maxDisconnect: number;
  earlyEntryMinutes: number;
}

/**
 * 一次作答的完整视图。
 *
 * `answers` 里的选择键是**显示字母**——与前端会话里的作答口径一致；
 * 换算成原题键发生在上行那一刻（见 `api/answerPayload.ts`）。
 */
export interface AttemptSurface {
  attemptId: string;
  attemptNo: number;
  targetType: "exam" | "practice";
  status: AttemptStatus;
  statusLabel: string;
  /** 服务端当前时间。 */
  serverTime: string;
  startedAt: string | null;
  /** 绝对截止时间（服务端口径）。 */
  deadlineAt: string;
  remainingSeconds: number;
  elapsedSeconds: number;
  timed: boolean;
  /** 置换身份：标准卷恒为 `STD`，梅花卷是派生键。 */
  variantKey: string;
  /** 卷面题目（按卷面顺序）。 */
  questions: SurfaceQuestion[];
  /** 已保存的答案：题目 ID → 载荷。 */
  answers: Record<string, AnswerPayload>;
  /** 服务端已接受的最大客户端序列号。 */
  lastClientSeq: number;
  /** 考试规则。 */
  rules: AttemptRules;
}

/** 我的作答摘要。 */
export interface AttemptSummary {
  id: string;
  targetType: "exam" | "practice";
  examName: string | null;
  status: AttemptStatus;
  statusLabel: string;
  attemptNo: number;
  startedAt: string | null;
  submittedAt: string | null;
  deadlineAt: string;
  /** 所属场次 ID（练习为空）。 */
  examSessionId: string | null;
}
