/* ==========================================================================
   知行测评 · 作答会话的后端读取与写入
   --------------------------------------------------------------------------
   HTTP 模式下考生卷面来自服务端：选项已按该考生的置换顺序排列，
   但每个选项的 `key` 仍是**原题键**——服务端判分按原题键比较，
   前端要按显示位置重新编号成 A/B/C 给考生看。

   这一层负责把后端 DTO 映射成前端口径：
   - ID 一律转字符串；
   - 枚举值做「存储值 → 前端口径」的转换；
   - 回填本地的答案把原题键换算成显示字母（上行方向的换算在传输层）。

   卷面里没有正确答案、解析与参考答案——考试进行中下发这些等于泄题，
   映射时也不去臆造这些字段。
   ========================================================================== */

import { httpClient } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import { toDomainPayload, type OptionKeyMap } from "./answerPayload";
import { LETTERS } from "../engine/paper";
import type {
  AttemptRules,
  AttemptStatus,
  AttemptSummary,
  AttemptSurface,
  SurfaceAttachment,
  SurfaceOption,
  SurfaceQuestion,
  SurfaceStep,
} from "../domain/attempt";
import type { QuestionType } from "../domain/types";

/** 作答接口所需的最小客户端接口（便于端到端测试注入自定义基地址）。 */
export type AttemptClient = Pick<typeof httpClient, "get" | "post">;

/** 后端 DTO（宽松声明；字段以 OpenAPI 契约为准）。 */
type Dto = Record<string, unknown>;

function str(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => str(v));
}

/** 后端作答状态 → 前端作答状态。 */
function toAttemptStatus(raw: string): AttemptStatus {
  switch (raw) {
    case "in_progress":
      return "in_progress";
    case "submitted":
      return "submitted";
    case "auto_submitted":
      return "auto_submitted";
    case "force_submitted":
      return "force_submitted";
    case "abandoned":
      return "abandoned";
    default:
      return "not_started";
  }
}

/** 映射选项（键是原题键，顺序即卷面显示顺序）。 */
function toSurfaceOption(dto: Dto): SurfaceOption {
  return { key: str(dto.key), text: str(dto.text) };
}

/** 映射综合题步骤（不含参考答案与关键词）。 */
function toSurfaceStep(dto: Dto): SurfaceStep {
  return { code: str(dto.code), prompt: str(dto.prompt), score: num(dto.score) };
}

/** 映射附件引用。 */
function toSurfaceAttachment(dto: Dto): SurfaceAttachment {
  return {
    objectKey: str(dto.objectKey),
    fileName: str(dto.fileName),
    contentType: str(dto.contentType),
    sizeBytes: num(dto.sizeBytes),
  };
}

/** 映射卷面里的一道题。 */
function toSurfaceQuestion(dto: Dto): SurfaceQuestion {
  return {
    id: str(dto.questionId),
    type: str(dto.type, "single") as QuestionType,
    stem: str(dto.stem),
    score: num(dto.score),
    options: Array.isArray(dto.options) ? dto.options.map((o) => toSurfaceOption(o as Dto)) : [],
    tagIds: strList(dto.tagIds),
    difficultyTagId: str(dto.difficultyTagId),
    difficulty: str(dto.difficulty),
    sectionTitle: dto.sectionTitle ? str(dto.sectionTitle) : null,
    steps: Array.isArray(dto.steps) ? dto.steps.map((s) => toSurfaceStep(s as Dto)) : [],
    attachments: Array.isArray(dto.attachments)
      ? dto.attachments.map((a) => toSurfaceAttachment(a as Dto))
      : [],
  };
}

/** 映射考试规则。 */
function toAttemptRules(dto: Dto | undefined): AttemptRules {
  const rules = dto ?? {};
  const maxFocusLoss = rules.maxFocusLoss;
  return {
    maxFocusLoss: typeof maxFocusLoss === "number" ? maxFocusLoss : null,
    onMaxFocusLoss: str(rules.onMaxFocusLoss, "force_submit"),
    requireFullScreen: bool(rules.requireFullScreen),
    blockCopyPaste: bool(rules.blockCopyPaste),
    blockContextMenu: bool(rules.blockContextMenu),
    showWatermark: bool(rules.showWatermark),
    enableHeartbeatCheck: bool(rules.enableHeartbeatCheck),
    heartbeatIntervalSeconds: num(rules.heartbeatIntervalSeconds, 30),
    heartbeatTimeoutSeconds: num(rules.heartbeatTimeoutSeconds, 90),
    maxDisconnect: num(rules.maxDisconnect, 3),
    earlyEntryMinutes: num(rules.earlyEntryMinutes, 0),
  };
}

/**
 * 由卷面题目导出选择键换算表（显示字母 → 原题键）。
 *
 * 卷面按显示顺序给出选项，位置就是显示字母；选项的 `key` 是原题键。
 */
export function buildOptionKeyMap(questions: SurfaceQuestion[]): OptionKeyMap {
  const map: OptionKeyMap = {};
  for (const question of questions) {
    const per: Record<string, string> = {};
    question.options.forEach((option, position) => {
      const letter = LETTERS[position];
      if (letter) per[letter] = option.key;
    });
    map[question.id] = per;
  }
  return map;
}

/**
 * 映射一次作答的完整视图（`AttemptResponse`）。
 *
 * 已保存的答案按题目的换算表把原题键换回显示字母，
 * 这样前端会话里的作答口径与 mock 模式完全一致。
 */
export function toAttemptSurface(dto: Dto): AttemptSurface {
  const questions = Array.isArray(dto.questions)
    ? dto.questions.map((q) => toSurfaceQuestion(q as Dto))
    : [];
  const keyMap = buildOptionKeyMap(questions);

  const answers: AttemptSurface["answers"] = {};
  if (Array.isArray(dto.answers)) {
    for (const raw of dto.answers) {
      const answer = raw as Dto;
      const questionId = str(answer.questionId);
      if (!questionId) continue;
      const payload = (answer.payload ?? {}) as Parameters<typeof toDomainPayload>[0];
      answers[questionId] = toDomainPayload(payload, keyMap[questionId]);
    }
  }

  return {
    attemptId: str(dto.attemptId),
    attemptNo: num(dto.attemptNo, 1),
    targetType: str(dto.targetType, "exam") === "practice" ? "practice" : "exam",
    status: toAttemptStatus(str(dto.status)),
    statusLabel: str(dto.statusLabel),
    serverTime: str(dto.serverTime),
    startedAt: dto.startedAt ? str(dto.startedAt) : null,
    deadlineAt: str(dto.deadlineAt),
    remainingSeconds: num(dto.remainingSeconds),
    elapsedSeconds: num(dto.elapsedSeconds),
    timed: bool(dto.timed),
    variantKey: str(dto.variantKey, "STD"),
    questions,
    answers,
    lastClientSeq: num(dto.lastClientSeq),
    rules: toAttemptRules(dto.rules as Dto | undefined),
  };
}

/** 映射作答摘要（`AttemptSummaryDto`）。 */
function toAttemptSummary(dto: Dto): AttemptSummary {
  return {
    id: str(dto.id),
    targetType: str(dto.targetType, "exam") === "practice" ? "practice" : "exam",
    examName: dto.examName ? str(dto.examName) : null,
    status: toAttemptStatus(str(dto.status)),
    statusLabel: str(dto.statusLabel),
    attemptNo: num(dto.attemptNo, 1),
    startedAt: dto.startedAt ? str(dto.startedAt) : null,
    submittedAt: dto.submittedAt ? str(dto.submittedAt) : null,
    deadlineAt: str(dto.deadlineAt),
    examSessionId: dto.examSessionId ? str(dto.examSessionId) : null,
  };
}

/**
 * 开始（或续上）一次考试作答。
 *
 * 服务端幂等：已有进行中的会话时返回同一个，不会新建。
 */
export async function startExamAttempt(
  examSessionId: string,
  client: AttemptClient = httpClient,
): Promise<AttemptSurface> {
  const dto = await client.post<Dto>(ENDPOINTS.delivery.startAttempt, {
    examSessionId: Number(examSessionId),
  });
  return toAttemptSurface(dto);
}

/** 读取一次作答的完整视图。 */
export async function getAttempt(
  attemptId: string,
  client: AttemptClient = httpClient,
): Promise<AttemptSurface> {
  const dto = await client.get<Dto>(ENDPOINTS.delivery.attempt(attemptId));
  return toAttemptSurface(dto);
}

/** 我的作答列表。 */
export async function listMyAttempts(
  client: AttemptClient = httpClient,
): Promise<AttemptSummary[]> {
  const res = await client.get<{ items?: Dto[] } | Dto[]>(ENDPOINTS.delivery.attempts);
  const items = Array.isArray(res) ? res : (res.items ?? []);
  return items.map(toAttemptSummary);
}

/** 交卷结果。 */
export interface SubmitResult {
  attemptId: string;
  status: string;
  statusLabel: string;
  submittedAt: string | null;
  submitReason: string;
  submitReasonLabel: string;
  objectiveScore: number;
  objectiveMax: number;
  subjectivePending: boolean;
  totalScore: number;
  totalMax: number;
  gradeVisibility: string;
}

/** 交卷。 */
export async function submitAttempt(
  attemptId: string,
  reason?: string,
  client: AttemptClient = httpClient,
): Promise<SubmitResult> {
  const dto = await client.post<Dto>(ENDPOINTS.delivery.attemptSubmit(attemptId), {
    reason: reason ?? null,
  });
  return {
    attemptId: str(dto.attemptId),
    status: str(dto.status),
    statusLabel: str(dto.statusLabel),
    submittedAt: dto.submittedAt ? str(dto.submittedAt) : null,
    submitReason: str(dto.submitReason),
    submitReasonLabel: str(dto.submitReasonLabel),
    objectiveScore: num(dto.objectiveScore),
    objectiveMax: num(dto.objectiveMax),
    subjectivePending: bool(dto.subjectivePending),
    totalScore: num(dto.totalScore),
    totalMax: num(dto.totalMax),
    gradeVisibility: str(dto.gradeVisibility),
  };
}

/** 一条焦点事件。 */
export interface FocusEventInput {
  type: string;
  questionId?: number | null;
  clientAt?: string | null;
}

/** 焦点事件上报结果（切屏计数以服务端为准）。 */
export interface FocusEventsResult {
  focusLossCount: number;
  limit: number | null;
  limitReached: boolean;
  forcedSubmit: boolean;
  warned: boolean;
  disconnectCount: number;
  warningCount: number;
  serverTime: string;
}

/** 上报焦点事件。 */
export async function reportFocusEvents(
  attemptId: string,
  events: FocusEventInput[],
  client: AttemptClient = httpClient,
): Promise<FocusEventsResult> {
  const dto = await client.post<Dto>(ENDPOINTS.delivery.attemptFocusEvents(attemptId), {
    events: events.map((event) => ({
      type: event.type,
      questionId: event.questionId ?? null,
      clientAt: event.clientAt ?? null,
    })),
  });
  const limit = dto.limit;
  return {
    focusLossCount: num(dto.focusLossCount),
    limit: typeof limit === "number" ? limit : null,
    limitReached: bool(dto.limitReached),
    forcedSubmit: bool(dto.forcedSubmit),
    warned: bool(dto.warned),
    disconnectCount: num(dto.disconnectCount),
    warningCount: num(dto.warningCount),
    serverTime: str(dto.serverTime),
  };
}

/** 心跳结果。 */
export interface HeartbeatResult {
  serverTime: string;
  remainingSeconds: number;
  disconnectCount: number;
  warningCount: number;
  status: string;
  submitted: boolean;
  submitReason: string;
}

/** 心跳。 */
export async function heartbeatAttempt(
  attemptId: string,
  client: AttemptClient = httpClient,
): Promise<HeartbeatResult> {
  const dto = await client.post<Dto>(ENDPOINTS.delivery.attemptHeartbeat(attemptId));
  return {
    serverTime: str(dto.serverTime),
    remainingSeconds: num(dto.remainingSeconds),
    disconnectCount: num(dto.disconnectCount),
    warningCount: num(dto.warningCount),
    status: str(dto.status),
    submitted: bool(dto.submitted),
    submitReason: str(dto.submitReason),
  };
}
