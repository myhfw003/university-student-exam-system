/* ==========================================================================
   知行测评 · 阅卷任务的后端读写
   --------------------------------------------------------------------------
   阅卷队列、卷宗详情、领取 / 指派 / 评分 / 批量采纳。

   两处口径要注意：
   1. **初判在服务端**：建议分（suggestedScore）、要点命中（keypoints）、
      步骤命中（steps）都是服务端给的，前端不重算。
   2. **领取是抢占式的**：任务被别人领走后再领会失败（409 / 422）。
   ========================================================================== */

import { ENDPOINTS } from "./endpoints";
import { httpClient } from "./httpClient";
import type {
  BatchAdoptItem,
  BatchAdoptResult,
  ReviewCounts,
  ReviewGradeResult,
  ReviewKeypoint,
  ReviewStep,
  ReviewTask,
  ReviewTaskDetail,
  ReviewTaskStatus,
} from "../domain/review";

/** 阅卷接口所需的客户端。 */
export type ReviewClient = Pick<typeof httpClient, "get" | "post">;

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

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => str(v)) : [];
}

/** 阅卷任务状态 → 前端口径。 */
export function toReviewStatus(value: unknown): ReviewTaskStatus {
  switch (str(value)) {
    case "in_review":
      return "in_review";
    case "reviewed":
      return "reviewed";
    default:
      return "pending";
  }
}

/** 阅卷任务 DTO → 前端口径。 */
export function toReviewTask(dto: Dto): ReviewTask {
  return {
    id: str(dto.id),
    attemptId: str(dto.attemptId),
    attemptNo: num(dto.attemptNo, 1),
    examName: str(dto.examName),
    examSessionId:
      dto.examSessionId === null || dto.examSessionId === undefined
        ? null
        : str(dto.examSessionId),
    questionId: str(dto.questionId),
    questionCode: str(dto.questionCode),
    questionType: str(dto.questionType),
    stepCode: dto.stepCode ? str(dto.stepCode) : null,
    answerText: str(dto.answerText),
    suggestedScore: numOrNull(dto.suggestedScore),
    maxScore: num(dto.maxScore),
    status: toReviewStatus(dto.status),
    statusLabel: str(dto.statusLabel),
    assigneeId: dto.assigneeId === null || dto.assigneeId === undefined ? null : str(dto.assigneeId),
    reviewerId: dto.reviewerId === null || dto.reviewerId === undefined ? null : str(dto.reviewerId),
    finalScore: numOrNull(dto.finalScore),
    comment: str(dto.comment),
    createdAt: str(dto.createdAt),
    reviewedAt: dto.reviewedAt ? str(dto.reviewedAt) : null,
    studentUsername: str(dto.studentUsername),
    studentDisplayName: str(dto.studentDisplayName),
  };
}

/** 阅卷任务队列。 */
export interface ReviewTaskPage {
  items: ReviewTask[];
  total: number;
}

/** 读取阅卷任务队列。 */
export async function loadReviewTasks(
  params: {
    status?: string | undefined;
    examSessionId?: string | undefined;
    questionId?: string | undefined;
    assigneeId?: string | undefined;
    mine?: boolean | undefined;
    page?: number | undefined;
    size?: number | undefined;
  } = {},
  client: ReviewClient = httpClient,
): Promise<ReviewTaskPage> {
  const res = await client.get<{ items?: Dto[]; total?: number }>(ENDPOINTS.admin.reviewTasks, {
    query: {
      page: 1,
      size: 50,
      ...(params.status && params.status !== "all" ? { status: params.status } : {}),
      ...(params.examSessionId ? { examSessionId: params.examSessionId } : {}),
      ...(params.questionId ? { questionId: params.questionId } : {}),
      ...(params.assigneeId ? { assigneeId: params.assigneeId } : {}),
      ...(params.mine ? { mine: true } : {}),
    },
  });
  const items = (res.items ?? []).map(toReviewTask);
  return { items, total: num(res.total, items.length) };
}

/** 读取阅卷任务计数（待领取 / 阅卷中 / 已阅完 / 我的）。 */
export async function loadReviewCounts(
  params: { examSessionId?: string | undefined } = {},
  client: ReviewClient = httpClient,
): Promise<ReviewCounts> {
  const res = await client.get<{
    pending?: number;
    inReview?: number;
    reviewed?: number;
    mine?: number;
  }>(ENDPOINTS.admin.reviewTaskCount, {
    query: params.examSessionId ? { examSessionId: params.examSessionId } : {},
  });
  return {
    pending: num(res.pending),
    inReview: num(res.inReview),
    reviewed: num(res.reviewed),
    mine: num(res.mine),
  };
}

/** 读取卷宗详情（作答原文 + 参考答案 + 初判命中）。 */
export async function loadReviewTaskDetail(
  id: string,
  client: ReviewClient = httpClient,
): Promise<ReviewTaskDetail> {
  const res = await client.get<Dto>(`${ENDPOINTS.admin.reviewTasks}/${id}`);
  const keypoints: ReviewKeypoint[] = Array.isArray(res.keypoints)
    ? (res.keypoints as Dto[]).map((dto) => ({ text: str(dto.text), hit: dto.hit === true }))
    : [];
  const steps: ReviewStep[] = Array.isArray(res.steps)
    ? (res.steps as Dto[]).map((dto) => ({
        code: str(dto.code),
        prompt: str(dto.prompt),
        score: num(dto.score),
        hit: dto.hit === true,
      }))
    : [];

  return {
    task: toReviewTask((res.task ?? {}) as Dto),
    stem: str(res.stem),
    questionType: str(res.questionType),
    questionTypeLabel: str(res.questionTypeLabel),
    referenceAnswer: str(res.referenceAnswer),
    analysis: str(res.analysis),
    keypoints,
    steps,
    hitItems: strList(res.hitItems),
    missedItems: strList(res.missedItems),
    notes: strList(res.notes),
    studentUsername: str(res.studentUsername),
    studentDisplayName: str(res.studentDisplayName),
  };
}

/** 领取阅卷任务（先到先得）。 */
export async function claimReviewTask(
  id: string,
  client: ReviewClient = httpClient,
): Promise<ReviewTask> {
  const res = await client.post<Dto>(`${ENDPOINTS.admin.reviewTasks}/${id}/claim`);
  return toReviewTask(res);
}

/** 指派阅卷任务给指定阅卷人。 */
export async function assignReviewTask(
  id: string,
  userId: string,
  client: ReviewClient = httpClient,
): Promise<ReviewTask> {
  const res = await client.post<Dto>(`${ENDPOINTS.admin.reviewTasks}/${id}/assign`, {
    userId: Number(userId),
  });
  return toReviewTask(res);
}

/** 人工评分。分数 0..满分、0.5 为步进；每次评分都追加一条改分流水。 */
export async function gradeReviewTask(
  id: string,
  input: { score: number; comment?: string },
  client: ReviewClient = httpClient,
): Promise<ReviewGradeResult> {
  const res = await client.post<{
    reviewTaskId?: number;
    status?: string;
    statusLabel?: string;
    finalScore?: number;
    maxScore?: number;
    comment?: string | null;
    scoreResultStatus?: string;
    scoreResultStatusLabel?: string;
    revision?: number;
  }>(`${ENDPOINTS.admin.reviewTasks}/${id}/grade`, {
    score: input.score,
    comment: input.comment ?? "",
  });

  return {
    reviewTaskId: str(res.reviewTaskId, id),
    status: toReviewStatus(res.status),
    statusLabel: str(res.statusLabel),
    finalScore: num(res.finalScore),
    maxScore: num(res.maxScore),
    comment: str(res.comment),
    scoreResultStatus: str(res.scoreResultStatus),
    scoreResultStatusLabel: str(res.scoreResultStatusLabel),
    revision: num(res.revision, 1),
  };
}

/**
 * 批量采纳初判建议。
 *
 * 只影响**待领取**的任务，逐条给出采纳与跳过的结果。
 * `confirm` 必须为 true——批量定分不可逆，客户端先做二次确认。
 */
export async function batchAdoptReviewTasks(
  input: {
    taskIds?: string[] | undefined;
    examSessionId?: string | undefined;
    questionId?: string | undefined;
    maxCount?: number | undefined;
    comment?: string | undefined;
  },
  client: ReviewClient = httpClient,
): Promise<BatchAdoptResult> {
  const res = await client.post<{
    total?: number;
    adopted?: number;
    skipped?: number;
    items?: Array<{
      taskId?: number;
      status?: string;
      statusLabel?: string;
      finalScore?: number | null;
      message?: string | null;
    }>;
  }>(`${ENDPOINTS.admin.reviewTasks}/batch-adopt`, {
    taskIds: input.taskIds?.map(Number),
    examSessionId: input.examSessionId ? Number(input.examSessionId) : null,
    questionId: input.questionId ? Number(input.questionId) : null,
    maxCount: input.maxCount ?? null,
    comment: input.comment ?? "",
    confirm: true,
  });

  const items: BatchAdoptItem[] = (res.items ?? []).map((dto) => ({
    taskId: str(dto.taskId),
    status: toReviewStatus(dto.status),
    statusLabel: str(dto.statusLabel),
    finalScore: numOrNull(dto.finalScore),
    message: str(dto.message),
  }));

  return {
    total: num(res.total, items.length),
    adopted: num(res.adopted),
    skipped: num(res.skipped),
    items,
  };
}

/** 队列中的上一份 / 下一份（连续阅卷用）。 */
export async function loadReviewTaskNeighbors(
  id: string,
  params: { status?: string | undefined; examSessionId?: string | undefined } = {},
  client: ReviewClient = httpClient,
): Promise<{ previousId: string | null; nextId: string | null }> {
  const res = await client.get<{ previousId?: number | null; nextId?: number | null }>(
    `${ENDPOINTS.admin.reviewTasks}/${id}/neighbors`,
    {
      query: {
        ...(params.status && params.status !== "all" ? { status: params.status } : {}),
        ...(params.examSessionId ? { examSessionId: params.examSessionId } : {}),
      },
    },
  );
  return {
    previousId: res.previousId === null || res.previousId === undefined ? null : str(res.previousId),
    nextId: res.nextId === null || res.nextId === undefined ? null : str(res.nextId),
  };
}
