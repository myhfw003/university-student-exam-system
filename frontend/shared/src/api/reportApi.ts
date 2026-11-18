/* ==========================================================================
   知行测评 · 成绩报告的后端读取
   --------------------------------------------------------------------------
   成绩由服务端判完再下发，前端不重算。这一层把 DTO 映射成前端口径：

   - ID 一律转字符串；
   - 分数保留原值（「还没定分」是 null，不是 0）；
   - 选择键**保持原题键**——换回显示字母要靠卷面的换算表，
     在 `engine/report.ts` 里统一做（这里没有卷面上下文）。
   ========================================================================== */

import { httpClient } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import { toDomainPayload, type ServerAnswerPayload } from "./answerPayload";
import type { AttemptReport, MyResult, ReportDetail } from "../domain/attempt";
import type { QuestionType } from "../domain/types";

/** 成绩接口所需的最小客户端接口（便于端到端测试注入自定义基地址）。 */
export type ReportClient = Pick<typeof httpClient, "get">;

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

/** 映射报告里的一道题。 */
function toReportDetail(dto: Dto): ReportDetail {
  const answer = dto.yourAnswer as ServerAnswerPayload | null | undefined;
  return {
    questionId: str(dto.questionId),
    questionCode: str(dto.questionCode),
    type: str(dto.type, "single") as QuestionType,
    typeLabel: str(dto.typeLabel),
    stem: str(dto.stem),
    // 选择键保持原题键：换回显示字母要靠卷面的换算表。
    yourAnswer: answer ? toDomainPayload(answer) : null,
    correctKeys: Array.isArray(dto.correctKeys) ? dto.correctKeys.map((k) => str(k)) : [],
    referenceAnswer: dto.referenceAnswer ? str(dto.referenceAnswer) : null,
    analysis: dto.analysis ? str(dto.analysis) : null,
    score: numOrNull(dto.score),
    maxScore: num(dto.maxScore),
    revealed: bool(dto.revealed),
  };
}

/** 映射成绩报告。 */
export function toAttemptReport(dto: Dto): AttemptReport {
  return {
    attemptId: str(dto.attemptId),
    attemptNo: num(dto.attemptNo, 1),
    examName: dto.examName ? str(dto.examName) : null,
    submittedAt: dto.submittedAt ? str(dto.submittedAt) : null,
    objectiveScore: num(dto.objectiveScore),
    objectiveMax: num(dto.objectiveMax),
    subjectiveScore: numOrNull(dto.subjectiveScore),
    subjectiveMax: num(dto.subjectiveMax),
    totalScore: num(dto.totalScore),
    totalMax: num(dto.totalMax),
    status: str(dto.status),
    answersRevealed: bool(dto.answersRevealed),
    answerPolicy: str(dto.answerPolicy),
    details: Array.isArray(dto.details) ? dto.details.map((d) => toReportDetail(d as Dto)) : [],
  };
}

/** 映射我的成绩条目。 */
function toMyResult(dto: Dto): MyResult {
  return {
    attemptId: str(dto.attemptId),
    examName: dto.examName ? str(dto.examName) : null,
    examSessionId: dto.examSessionId ? str(dto.examSessionId) : null,
    practiceAssignmentId: dto.practiceAssignmentId ? str(dto.practiceAssignmentId) : null,
    attemptNo: num(dto.attemptNo, 1),
    submittedAt: dto.submittedAt ? str(dto.submittedAt) : null,
    totalScore: num(dto.totalScore),
    totalMax: num(dto.totalMax),
    subjectivePending: bool(dto.subjectivePending),
    status: str(dto.status),
  };
}

/**
 * 读取我的成绩列表。
 *
 * 只含已交卷的作答（强制交卷与超时自动交卷也算）。
 */
export async function loadMyResults(client: ReportClient = httpClient): Promise<MyResult[]> {
  const res = await client.get<{ items?: Dto[] } | Dto[]>(ENDPOINTS.learning.myResults);
  const items = Array.isArray(res) ? res : (res.items ?? []);
  return items.map(toMyResult);
}

/**
 * 读取一次作答的成绩报告。
 *
 * 正确答案与解析受答案公布策略约束：没到公布时机，接口一律不给。
 */
export async function loadAttemptReport(
  attemptId: string,
  client: ReportClient = httpClient,
): Promise<AttemptReport> {
  const dto = await client.get<Dto>(ENDPOINTS.learning.attemptsReport(attemptId));
  return toAttemptReport(dto);
}
