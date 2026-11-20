/* ==========================================================================
   知行测评 · 错题本与工作台的后端读取
   --------------------------------------------------------------------------
   这两处的数据都由服务端算好：错题分布、学期平均分、推荐练习都在后端。
   前端不重算——重算的口径一旦与服务端不一致，学生看到的两套数就对不上。

   - `GET /mistakes`：错题本（可按标签、题型、时间范围过滤）；
   - `POST /mistakes/{questionId}/redo`：单题重做（服务端把单题练习与会话开好）；
   - `POST /mistakes/{questionId}/resolve`：标记已掌握；
   - `GET /dashboard/summary`：工作台汇总。
   ========================================================================== */

import { httpClient } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import type {
  DashboardSummary,
  MistakeDistribution,
  MistakeEntry,
  OngoingExam,
  RecentResult,
  RecommendedPractice,
  RedoMistake,
  ScoreTrendPoint,
} from "../domain/learning";
import type { QuestionType } from "../domain/types";

/** 学习接口所需的最小客户端接口。 */
export type LearningClient = Pick<typeof httpClient, "get" | "post">;

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

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => str(v));
}

/* ---------------------------------------------------------------- 错题本 */

/** 映射错题本里的一条。 */
export function toMistakeEntry(dto: Dto): MistakeEntry {
  return {
    questionId: str(dto.questionId),
    questionCode: str(dto.questionCode),
    type: str(dto.questionType, "single") as QuestionType,
    typeLabel: str(dto.questionTypeLabel),
    stem: str(dto.stem),
    tagNames: strList(dto.tagNames),
    wrongCount: num(dto.wrongCount),
    reason: str(dto.reason),
    reasonLabel: str(dto.reasonLabel),
    sourceType: str(dto.sourceType),
    sourceTypeLabel: str(dto.sourceTypeLabel),
    lastWrongAt: str(dto.lastWrongAt),
    resolvedAt: dto.resolvedAt ? str(dto.resolvedAt) : null,
    sourceAttemptId: dto.sourceAttemptId ? str(dto.sourceAttemptId) : null,
  };
}

/**
 * 错题本筛选条件。
 *
 * 与服务端 `GET /mistakes` 的查询参数一一对应：
 * 标签只传一个（服务端会把它的子标签也算进来）、题型、时间范围、是否含已掌握。
 */
export interface MistakeFilter {
  /** 标签 ID。 */
  tagId?: string;
  /** 题型（single / multi / judge / short / comprehensive）。 */
  questionType?: string;
  /** 时间范围起点（含），ISO 日期时间。 */
  from?: string;
  /** 时间范围终点（含），ISO 日期时间。 */
  to?: string;
  /** 是否包含已掌握的题；默认不含。 */
  includeResolved?: boolean;
}

/**
 * 读取错题本。
 *
 * 默认不含已掌握的题（`includeResolved=false`）。
 */
export async function loadMistakes(
  filter: MistakeFilter = {},
  client: LearningClient = httpClient,
): Promise<MistakeEntry[]> {
  const res = await client.get<{ items?: Dto[] } | Dto[]>(ENDPOINTS.learning.mistakes, {
    query: {
      page: 1,
      size: 200,
      includeResolved: filter.includeResolved ?? false,
      ...(filter.tagId ? { tagId: filter.tagId } : {}),
      ...(filter.questionType ? { questionType: filter.questionType } : {}),
      ...(filter.from ? { from: filter.from } : {}),
      ...(filter.to ? { to: filter.to } : {}),
    },
  });
  const items = Array.isArray(res) ? res : (res.items ?? []);
  return items.map(toMistakeEntry);
}

/**
 * 单题重做：服务端把这道题做成只有一道题的练习，并直接开好会话。
 *
 * 返回的 `practiceAssignmentId` 用来跳练习页——
 * 练习页再调 `POST /attempts` 时，服务端会返回同一个进行中的会话。
 */
export async function redoMistake(
  questionId: string,
  client: LearningClient = httpClient,
): Promise<RedoMistake> {
  const dto = await client.post<Dto>(`${ENDPOINTS.learning.mistakes}/${questionId}/redo`);
  return {
    practiceAssignmentId: str(dto.practiceAssignmentId),
    attemptId: str(dto.attemptId),
    questionId: str(dto.questionId),
    questionCode: str(dto.questionCode),
    questionType: str(dto.questionType),
    title: str(dto.title),
    deadlineAt: str(dto.deadlineAt),
  };
}

/** 标记已掌握：这道题不再留在错题本里。 */
export async function resolveMistake(
  questionId: string,
  client: LearningClient = httpClient,
): Promise<MistakeEntry> {
  const dto = await client.post<Dto>(`${ENDPOINTS.learning.mistakes}/${questionId}/resolve`);
  return toMistakeEntry(dto);
}

/* -------------------------------------------------------------- 工作台 */

/** 映射进行中的考试。 */
function toOngoingExam(dto: Dto | undefined): OngoingExam | null {
  if (!dto) return null;
  return {
    examSessionId: str(dto.examSessionId),
    name: str(dto.name),
    openAt: str(dto.openAt),
    closeAt: str(dto.closeAt),
    note: dto.note ? str(dto.note) : null,
    started: bool(dto.started),
  };
}

/** 映射推荐练习。 */
function toRecommendedPractice(dto: Dto): RecommendedPractice {
  return {
    id: str(dto.id),
    title: str(dto.title),
    tagNames: strList(dto.tagNames),
  };
}

/** 映射最近成绩。 */
function toRecentResult(dto: Dto): RecentResult {
  return {
    attemptId: str(dto.attemptId),
    kind: str(dto.kind, "exam"),
    name: str(dto.name),
    date: str(dto.date).slice(0, 10),
    score: num(dto.score),
    total: num(dto.total),
    status: str(dto.status),
  };
}

/** 映射成绩趋势上的一个点。 */
function toScoreTrendPoint(dto: Dto): ScoreTrendPoint {
  return {
    date: str(dto.date).slice(0, 10),
    score: num(dto.score),
    total: num(dto.total),
  };
}

/** 映射错题分布的一个分组。 */
function toMistakeDistribution(dto: Dto): MistakeDistribution {
  return {
    tagName: str(dto.tagName),
    group: str(dto.group),
    count: num(dto.count),
  };
}

/**
 * 读取学生工作台汇总。
 *
 * 统计口径都在服务端：待完成练习、进行中考试、学期平均分、待订正错题、
 * 推荐练习、最近成绩、成绩趋势与错题分布。
 */
export async function loadDashboardSummary(
  client: LearningClient = httpClient,
): Promise<DashboardSummary> {
  const dto = await client.get<Dto>(ENDPOINTS.learning.dashboard);
  return {
    pendingPractices: num(dto.pendingPractices),
    ongoingExams: num(dto.ongoingExams),
    termAverageScore: numOrNull(dto.termAverageScore),
    pendingMistakes: num(dto.pendingMistakes),
    ongoingExam: toOngoingExam(dto.ongoingExam as Dto | undefined),
    recommendedPractices: Array.isArray(dto.recommendedPractices)
      ? dto.recommendedPractices.map((p) => toRecommendedPractice(p as Dto))
      : [],
    recentResults: Array.isArray(dto.recentResults)
      ? dto.recentResults.map((r) => toRecentResult(r as Dto))
      : [],
    scoreTrend: Array.isArray(dto.scoreTrend)
      ? dto.scoreTrend.map((p) => toScoreTrendPoint(p as Dto))
      : [],
    mistakeDistribution: Array.isArray(dto.mistakeDistribution)
      ? dto.mistakeDistribution.map((d) => toMistakeDistribution(d as Dto))
      : [],
    generatedAt: str(dto.generatedAt),
  };
}
