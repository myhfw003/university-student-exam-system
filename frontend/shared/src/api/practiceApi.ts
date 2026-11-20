/* ==========================================================================
   知行测评 · 练习的后端读取
   --------------------------------------------------------------------------
   学生端看到的是**练习开放单**：一条开放单挂一份练习卷，
   开放单自己带次数上限、反馈时机与错题回流设置。

   - `GET /practices`：学生可见的开放单列表（后端已按可见范围过滤）；
   - `GET /practices/{id}`：其中一条（与列表里的一项是同一个 DTO）；
   - `POST /attempts/{id}/feedback`：练习即时反馈（正确答案与解析）。

   反馈里的正确答案键是**原题键**——换回显示字母要靠卷面的换算表。
   ========================================================================== */

import { httpClient } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import type {
  AttemptFeedback,
  AttemptFeedbackQuestion,
  PracticeSummary,
} from "../domain/attempt";
import type { QuestionType } from "../domain/types";

/** 练习接口所需的最小客户端接口。 */
export type PracticeClient = Pick<typeof httpClient, "get" | "post">;

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

/** 映射练习开放单。 */
export function toPracticeSummary(dto: Dto): PracticeSummary {
  const remaining = dto.remainingAttempts;
  return {
    id: str(dto.id),
    title: str(dto.title),
    paperId: str(dto.paperId),
    paperName: str(dto.paperName),
    questionCount: num(dto.questionCount),
    totalScore: num(dto.totalScore),
    tagNames: Array.isArray(dto.tagNames) ? dto.tagNames.map((t) => str(t)) : [],
    maxAttempts: num(dto.maxAttempts),
    usedAttempts: num(dto.usedAttempts),
    remainingAttempts: typeof remaining === "number" ? remaining : null,
    feedbackTiming: str(dto.feedbackTiming, "after_submit"),
    reflowMistakes: bool(dto.reflowMistakes),
    suggestedMinutes: num(dto.suggestedMinutes),
    canStart: bool(dto.canStart),
  };
}

/**
 * 读取一条练习开放单。
 *
 * 与列表里的一项**完全一样**（服务端同一个 `PracticeSummaryDto`），
 * 区别是只取这一条——为了拿一条去拉整张表不值当。
 *
 * 看不见的开放单（不在可见范围内）服务端一律 404。
 */
export async function loadPractice(
  id: string,
  client: PracticeClient = httpClient,
): Promise<PracticeSummary> {
  const dto = await client.get<Dto>(`${ENDPOINTS.delivery.practices}/${id}`);
  return toPracticeSummary(dto);
}

/**
 * 读取学生可见的练习开放单。
 *
 * 后端已按可见范围过滤：这里拿到的就是能看的全部。
 */
export async function loadMyPractices(
  client: PracticeClient = httpClient,
): Promise<PracticeSummary[]> {
  const res = await client.get<{ items?: Dto[] } | Dto[]>(ENDPOINTS.delivery.practices, {
    query: { page: 1, size: 200 },
  });
  const items = Array.isArray(res) ? res : (res.items ?? []);
  return items.map(toPracticeSummary);
}

/** 映射反馈里的一道题。 */
function toFeedbackQuestion(dto: Dto): AttemptFeedbackQuestion {
  return {
    questionId: str(dto.questionId),
    code: str(dto.code),
    type: str(dto.type, "single") as QuestionType,
    typeLabel: str(dto.typeLabel),
    answered: bool(dto.answered),
    correct: typeof dto.correct === "boolean" ? dto.correct : null,
    score: num(dto.score),
    maxScore: num(dto.maxScore),
    correctKeys: Array.isArray(dto.correctKeys) ? dto.correctKeys.map((k) => str(k)) : [],
    referenceAnswer: dto.referenceAnswer ? str(dto.referenceAnswer) : null,
    analysis: dto.analysis ? str(dto.analysis) : null,
    details: Array.isArray(dto.details) ? dto.details.map((d) => str(d)) : [],
  };
}

/**
 * 读取练习即时反馈。
 *
 * 反馈时机由练习规则说了算：`immediate` 的练习作答后就能问，
 * `after_submit` 的要交卷后才给（没交卷时服务端会拒绝）。
 */
export async function loadAttemptFeedback(
  attemptId: string,
  client: PracticeClient = httpClient,
): Promise<AttemptFeedback> {
  const dto = await client.post<Dto>(ENDPOINTS.delivery.attemptFeedback(attemptId));
  return {
    attemptId: str(dto.attemptId),
    feedbackTiming: str(dto.feedbackTiming, "after_submit"),
    generatedAt: str(dto.generatedAt),
    questions: Array.isArray(dto.questions)
      ? dto.questions.map((q) => toFeedbackQuestion(q as Dto))
      : [],
  };
}
