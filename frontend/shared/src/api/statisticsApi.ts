/* ==========================================================================
   知行测评 · 成绩统计的后端读写
   --------------------------------------------------------------------------
   管理端的成绩分析按**场次**统计（一场考试一份分析）：
   参与 / 交卷 / 缺考、平均分与分段分布、及格率与优秀率、题型得分率、
   逐题正确率与掌握度、逐人成绩明细。

   两处口径要注意：
   1. 分数段的切分与「及格 / 优秀」的门槛都在**服务端**算，前端不重算——
      两边各算一套，同一场考试会给出两个不同的分布；
   2. 服务端给的是**比率**（0..1），这里统一换算成**百分数**（0..100），
      免得页面上出现「及格率 1%」这种读不通的数字。
   ========================================================================== */

import { ENDPOINTS } from "./endpoints";
import { httpClient } from "./httpClient";

/** 统计接口所需的客户端。 */
export type StatisticsClient = Pick<typeof httpClient, "get" | "post">;

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

/** 可空数值。 */
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 比率（0..1）→ 百分数（0..100）。 */
function percent(value: unknown): number | null {
  const ratio = numOrNull(value);
  return ratio === null ? null : ratio * 100;
}

/** 分数段。 */
export interface ScoreBucket {
  label: string;
  count: number;
}

/** 题型统计。 */
export interface TypeStatistic {
  type: string;
  typeLabel: string;
  answeredCount: number;
  averageScore: number | null;
  /** 得分率（百分数）。 */
  scoreRate: number | null;
}

/** 逐题统计。 */
export interface QuestionStatistic {
  questionId: string;
  code: string;
  type: string;
  typeLabel: string;
  stem: string;
  maxScore: number;
  answeredCount: number;
  correctCount: number;
  /** 正确率（百分数）。 */
  correctRate: number | null;
  averageScore: number | null;
  /** 掌握度（百分数）。 */
  mastery: number | null;
  /** 服务端给的讲评建议。 */
  suggestion: string;
}

/** 逐人成绩明细。 */
export interface StudentStatistic {
  userId: string;
  username: string;
  displayName: string;
  objectiveScore: number;
  subjectiveScore: number;
  totalScore: number;
  totalMax: number;
  /** 得分率（百分数）。 */
  scoreRate: number;
  submittedAt: string | null;
}

/** 一场考试的成绩分析。 */
export interface ExamSessionStatistics {
  examSessionId: string;
  examSessionName: string;
  participantCount: number;
  submittedCount: number;
  absentCount: number;
  averageScore: number | null;
  maxScore: number | null;
  minScore: number | null;
  /** 极差。 */
  scoreRange: number | null;
  /** 及格率（百分数）。 */
  passRate: number | null;
  /** 优秀率（百分数）。 */
  excellentRate: number | null;
  scoreBuckets: ScoreBucket[];
  typeStatistics: TypeStatistic[];
  questionStatistics: QuestionStatistic[];
  roster: StudentStatistic[];
  updatedAt: string;
}

/** 分数段 DTO → 前端口径。 */
function toScoreBucket(dto: Dto): ScoreBucket {
  return { label: str(dto.label), count: num(dto.count) };
}

/** 题型统计 DTO → 前端口径。 */
function toTypeStatistic(dto: Dto): TypeStatistic {
  return {
    type: str(dto.type),
    typeLabel: str(dto.typeLabel),
    answeredCount: num(dto.answeredCount),
    averageScore: numOrNull(dto.averageScore),
    scoreRate: percent(dto.scoreRate),
  };
}

/** 逐题统计 DTO → 前端口径。 */
function toQuestionStatistic(dto: Dto): QuestionStatistic {
  return {
    questionId: str(dto.questionId),
    code: str(dto.code),
    type: str(dto.type),
    typeLabel: str(dto.typeLabel),
    stem: str(dto.stem),
    maxScore: num(dto.maxScore),
    answeredCount: num(dto.answeredCount),
    correctCount: num(dto.correctCount),
    correctRate: percent(dto.correctRate),
    averageScore: numOrNull(dto.averageScore),
    mastery: percent(dto.mastery),
    suggestion: str(dto.suggestion),
  };
}

/** 逐人成绩 DTO → 前端口径。 */
function toStudentStatistic(dto: Dto): StudentStatistic {
  return {
    userId: str(dto.userId),
    username: str(dto.username),
    displayName: str(dto.displayName),
    objectiveScore: num(dto.objectiveScore),
    subjectiveScore: num(dto.subjectiveScore),
    totalScore: num(dto.totalScore),
    totalMax: num(dto.totalMax),
    scoreRate: percent(dto.scoreRate) ?? 0,
    submittedAt: dto.submittedAt ? str(dto.submittedAt) : null,
  };
}

/** 场次统计 DTO → 前端口径。 */
export function toExamSessionStatistics(dto: Dto): ExamSessionStatistics {
  return {
    examSessionId: str(dto.examSessionId),
    examSessionName: str(dto.examSessionName),
    participantCount: num(dto.participantCount),
    submittedCount: num(dto.submittedCount),
    absentCount: num(dto.absentCount),
    averageScore: numOrNull(dto.averageScore),
    maxScore: numOrNull(dto.maxScore),
    minScore: numOrNull(dto.minScore),
    scoreRange: numOrNull(dto.scoreRange),
    passRate: percent(dto.passRate),
    excellentRate: percent(dto.excellentRate),
    scoreBuckets: Array.isArray(dto.scoreBuckets)
      ? (dto.scoreBuckets as Dto[]).map(toScoreBucket)
      : [],
    typeStatistics: Array.isArray(dto.typeStatistics)
      ? (dto.typeStatistics as Dto[]).map(toTypeStatistic)
      : [],
    questionStatistics: Array.isArray(dto.questionStatistics)
      ? (dto.questionStatistics as Dto[]).map(toQuestionStatistic)
      : [],
    roster: Array.isArray(dto.roster) ? (dto.roster as Dto[]).map(toStudentStatistic) : [],
    updatedAt: str(dto.updatedAt),
  };
}

/** 读取一场考试的成绩分析。 */
export async function loadExamSessionStatistics(
  examSessionId: string,
  client: StatisticsClient = httpClient,
): Promise<ExamSessionStatistics> {
  const res = await client.get<Dto>(ENDPOINTS.admin.statisticsBySession(examSessionId));
  return toExamSessionStatistics(res);
}
