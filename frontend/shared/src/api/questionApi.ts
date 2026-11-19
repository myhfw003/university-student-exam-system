/* ==========================================================================
   知行测评 · 题目与题库的后端读写
   --------------------------------------------------------------------------
   题库是内容的组织容器，题目挂在题库里。管理端的两处主流程：

   - **题目**：列表过滤全部在服务端（题目可能成千上万，前端不该全拉回来自己筛）；
     状态变更走发布 / 停用 / 恢复三个端点，批量走 `batch-status`。
   - **题库**：题库本身只有名称与说明；题目的归属由「批量加入 / 移出题库」维护。
     **题库没有标签**（后端的题库表上没有标签列，也没有关联表）。

   一处口径要注意：真实后端里 `id` 是数字主键，**题号**是独立的 `code`；
   mock 模式的题号就是 id。
   ========================================================================== */

import { ENDPOINTS } from "./endpoints";
import { httpClient } from "./httpClient";
import type {
  Question,
  QuestionAttachment,
  QuestionKeypoint,
  QuestionOption,
  QuestionStep,
  QuestionType,
} from "../domain/types";

/** 题目与题库接口所需的客户端。 */
export type QuestionClient = Pick<typeof httpClient, "get" | "post" | "put" | "delete">;

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

function numList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

/** 题目摘要。 */
export interface AdminQuestionSummary {
  id: string;
  /** 题号（人读的编号）。 */
  code: string;
  type: QuestionType;
  typeLabel: string;
  stem: string;
  /** 默认分值。 */
  score: number;
  status: string;
  statusLabel: string;
  source: string;
  /** 难度标签 ID。 */
  difficultyTagId: string;
  /** 挂载的标签 ID。 */
  tagIds: string[];
  createdAt: string;
  updatedAt: string | null;
}

/** 题目详情。 */
export interface AdminQuestionDetail extends AdminQuestionSummary {
  options: QuestionOption[];
  /** 正确答案的选项键。 */
  answer: string[];
  keypoints: QuestionKeypoint[];
  steps: QuestionStep[];
  attachments: QuestionAttachment[];
  analysis: string;
  reference: string;
}

/** 题目摘要 DTO → 前端口径。 */
export function toQuestionSummary(dto: Dto): AdminQuestionSummary {
  return {
    id: str(dto.id),
    code: str(dto.code),
    type: str(dto.type, "single") as QuestionType,
    typeLabel: str(dto.typeLabel),
    stem: str(dto.stem),
    score: num(dto.defaultScore, 5),
    status: str(dto.status, "draft"),
    statusLabel: str(dto.statusLabel),
    source: str(dto.source, "manual"),
    difficultyTagId: str(dto.difficultyTagId),
    tagIds: numList(dto.tagIds),
    createdAt: str(dto.createdAt),
    updatedAt: dto.updatedAt ? str(dto.updatedAt) : null,
  };
}

/** 题目详情 DTO → 前端口径（可直接当编辑器与列表的题目用）。 */
export function toQuestionDetail(dto: Dto): AdminQuestionDetail {
  const summary = toQuestionSummary((dto.question ?? dto) as Dto);
  const options: QuestionOption[] = Array.isArray(dto.options)
    ? (dto.options as Dto[]).map((o) => ({ key: str(o.key), text: str(o.text) }))
    : [];
  const answer = Array.isArray(dto.options)
    ? (dto.options as Dto[]).filter((o) => o.isCorrect === true).map((o) => str(o.key))
    : [];
  const keypoints: QuestionKeypoint[] = Array.isArray(dto.keypoints)
    ? (dto.keypoints as Dto[]).map((k) => ({
        text: str(k.text),
        keywords: Array.isArray(k.keywords) ? k.keywords.map((x) => str(x)) : [],
      }))
    : [];
  const steps: QuestionStep[] = Array.isArray(dto.steps)
    ? (dto.steps as Dto[]).map((s) => ({
        id: str(s.code),
        prompt: str(s.prompt),
        answer: str(s.referenceAnswer),
        keywords: Array.isArray(s.keywords) ? s.keywords.map((x) => str(x)) : [],
        score: num(s.score),
      }))
    : [];
  const attachments: QuestionAttachment[] = Array.isArray(dto.attachments)
    ? (dto.attachments as Dto[]).map((a) => ({
        id: str(a.id),
        fileName: str(a.fileName),
        mimeType: str(a.contentType),
        size: num(a.sizeBytes),
        // 访问地址要按附件单独取签名 URL（见 QuestionAttachmentsController）。
        url: "",
      }))
    : [];

  return {
    ...summary,
    options,
    answer,
    keypoints,
    steps,
    attachments,
    analysis: str(dto.analysis),
    reference: str(dto.referenceAnswer),
  };
}

/** 题目详情 → 前端领域里的题目（编辑器与列表都用这一份）。 */
export function toFrontendQuestion(detail: AdminQuestionDetail): Question {
  return {
    id: detail.id,
    code: detail.code,
    type: detail.type,
    score: detail.score,
    status: detail.status as Question["status"],
    source: detail.source as Question["source"],
    tags: detail.tagIds,
    stem: detail.stem,
    options: detail.options,
    answer: detail.answer,
    analysis: detail.analysis,
    reference: detail.reference,
    keypoints: detail.keypoints,
    steps: detail.steps,
    attachments: detail.attachments,
  };
}

/* ------------------------------------------------------------------ 题目 */

/** 题目列表的一页。 */
export interface AdminQuestionPage {
  items: AdminQuestionSummary[];
  total: number;
}

/** 读取题目列表（过滤在服务端）。 */
export async function loadQuestions(
  params: {
    bankId?: string | undefined;
    type?: string | undefined;
    status?: string | undefined;
    tagIds?: string[] | undefined;
    keyword?: string | undefined;
    matchMode?: string | undefined;
    page?: number | undefined;
    size?: number | undefined;
  } = {},
  client: QuestionClient = httpClient,
): Promise<AdminQuestionPage> {
  const res = await client.get<{ items?: Dto[]; total?: number }>(ENDPOINTS.catalog.questions, {
    query: {
      page: 1,
      size: 50,
      ...(params.bankId ? { bankId: params.bankId } : {}),
      ...(params.type && params.type !== "all" ? { type: params.type } : {}),
      ...(params.status && params.status !== "all" ? { status: params.status } : {}),
      ...(params.tagIds?.length ? { tagIds: params.tagIds.join(",") } : {}),
      ...(params.matchMode ? { matchMode: params.matchMode } : {}),
      ...(params.keyword ? { keyword: params.keyword } : {}),
    },
  });
  const items = (res.items ?? []).map(toQuestionSummary);
  return { items, total: num(res.total, items.length) };
}

/** 读取题目详情。 */
export async function loadQuestion(
  id: string,
  client: QuestionClient = httpClient,
): Promise<AdminQuestionDetail> {
  const res = await client.get<Dto>(`${ENDPOINTS.catalog.questions}/${id}`);
  return toQuestionDetail(res);
}

/** 新建题目（新建一律是草稿）。 */
export async function createQuestion(
  input: {
    code: string;
    type: QuestionType;
    stem: string;
    defaultScore: number;
    tagIds: string[];
    difficultyTagId: string;
    options?: Array<{ key: string; text: string; isCorrect: boolean }> | undefined;
    keypoints?: Array<{ text: string; keywords: string[] }> | undefined;
    steps?: Array<{
      code: string;
      prompt: string;
      referenceAnswer: string;
      keywords: string[];
      score: number;
    }> | undefined;
    analysis?: string;
    referenceAnswer?: string;
  },
  client: QuestionClient = httpClient,
): Promise<AdminQuestionDetail> {
  const res = await client.post<Dto>(ENDPOINTS.catalog.questions, {
    code: input.code,
    type: input.type,
    stem: input.stem,
    defaultScore: input.defaultScore,
    tagIds: input.tagIds.map(Number),
    difficultyTagId: Number(input.difficultyTagId),
    options: input.options ?? null,
    keypoints: input.keypoints ?? null,
    steps: input.steps ?? null,
    analysis: input.analysis ?? "",
    referenceAnswer: input.referenceAnswer ?? "",
  });
  return toQuestionDetail(res);
}

/** 修改题目。 */
export async function updateQuestion(
  id: string,
  input: {
    code: string;
    type: QuestionType;
    stem: string;
    defaultScore: number;
    tagIds: string[];
    difficultyTagId: string;
    options?: Array<{ key: string; text: string; isCorrect: boolean }> | undefined;
    keypoints?: Array<{ text: string; keywords: string[] }> | undefined;
    steps?: Array<{
      code: string;
      prompt: string;
      referenceAnswer: string;
      keywords: string[];
      score: number;
    }> | undefined;
    analysis?: string;
    referenceAnswer?: string;
  },
  client: QuestionClient = httpClient,
): Promise<AdminQuestionDetail> {
  const res = await client.put<Dto>(`${ENDPOINTS.catalog.questions}/${id}`, {
    code: input.code,
    type: input.type,
    stem: input.stem,
    defaultScore: input.defaultScore,
    tagIds: input.tagIds.map(Number),
    difficultyTagId: Number(input.difficultyTagId),
    options: input.options ?? null,
    keypoints: input.keypoints ?? null,
    steps: input.steps ?? null,
    analysis: input.analysis ?? "",
    referenceAnswer: input.referenceAnswer ?? "",
  });
  return toQuestionDetail(res);
}

/** 删除题目。 */
export async function deleteQuestion(id: string, client: QuestionClient = httpClient): Promise<void> {
  await client.delete(`${ENDPOINTS.catalog.questions}/${id}`);
}

/** 题目状态变更：发布 / 停用 / 恢复。 */
export async function setQuestionStatus(
  id: string,
  action: "publish" | "disable" | "restore",
  client: QuestionClient = httpClient,
): Promise<void> {
  await client.post(`${ENDPOINTS.catalog.questions}/${id}/${action}`);
}

/** 批量状态变更的结果。 */
export interface BatchStatusResult {
  total: number;
  succeeded: number;
  /** 逐条结果：失败的给原因。 */
  items: Array<{ questionId: string; succeeded: boolean; reason: string }>;
}

/** 批量变更题目状态。 */
export async function batchQuestionStatus(
  questionIds: string[],
  targetStatus: string,
  client: QuestionClient = httpClient,
): Promise<BatchStatusResult> {
  const res = await client.post<{
    total?: number;
    succeeded?: number;
    items?: Array<{ questionId?: number; succeeded?: boolean; reason?: string | null }>;
  }>(`${ENDPOINTS.catalog.questions}/batch-status`, {
    questionIds: questionIds.map(Number),
    targetStatus,
  });

  return {
    total: num(res.total, questionIds.length),
    succeeded: num(res.succeeded),
    items: (res.items ?? []).map((item) => ({
      questionId: str(item.questionId),
      succeeded: item.succeeded === true,
      reason: str(item.reason),
    })),
  };
}

/* ------------------------------------------------------------------ 附件 */

/**
 * 上传题目附件。
 *
 * 文件落到服务端的私有桶，数据库只存引用；外部只能通过短期签名 URL 访问。
 * `questionId` 为空时先传文件、建题后再挂（题目还没有 ID 时用这个）。
 */
export async function uploadQuestionAttachment(
  file: File,
  questionId?: string,
  client: QuestionClient = httpClient,
): Promise<QuestionAttachment> {
  const form = new FormData();
  form.append("file", file, file.name);

  const res = await client.post<Dto>(
    `${ENDPOINTS.catalog.questions}/attachments${questionId ? `?questionId=${questionId}` : ""}`,
    form,
  );
  return {
    id: str(res.id),
    fileName: str(res.fileName, file.name),
    mimeType: str(res.contentType, file.type),
    size: num(res.sizeBytes, file.size),
    url: "",
  };
}

/** 取回题目的附件清单（不含访问地址）。 */
export async function listQuestionAttachments(
  questionId: string,
  client: QuestionClient = httpClient,
): Promise<QuestionAttachment[]> {
  const res = await client.get<Dto[]>(
    `${ENDPOINTS.catalog.questions}/${questionId}/attachments`,
  );
  return (Array.isArray(res) ? res : []).map((dto) => ({
    id: str(dto.id),
    fileName: str(dto.fileName),
    mimeType: str(dto.contentType),
    size: num(dto.sizeBytes),
    url: "",
  }));
}

/** 取附件的短期签名 URL。 */
export async function getQuestionAttachmentUrl(
  questionId: string,
  attachmentId: string,
  expirySeconds = 300,
  client: QuestionClient = httpClient,
): Promise<string> {
  const res = await client.get<{ url?: string }>(
    `${ENDPOINTS.catalog.questions}/${questionId}/attachments/${attachmentId}/url`,
    { query: { expirySeconds } },
  );
  return str(res.url);
}

/* ------------------------------------------------------------------ 题库 */

/** 题库摘要。 */
export interface AdminBank {
  id: string;
  name: string;
  description: string;
  /** 题库里的题目数。 */
  questionCount: number;
}

/** 题库统计：按状态与题型拆分。 */
export interface AdminBankStats {
  total: number;
  draft: number;
  published: number;
  disabled: number;
  objectiveCount: number;
  objectiveScore: number;
  subjectiveCount: number;
  subjectiveScore: number;
}

/** 题库详情：题库本身 + 题目清单 + 统计。 */
export interface AdminBankDetail {
  bank: AdminBank;
  questions: AdminQuestionSummary[];
  statistics: AdminBankStats;
}

/** 读取题库列表。 */
export async function loadBanks(client: QuestionClient = httpClient): Promise<AdminBank[]> {
  const res = await client.get<Dto[]>(ENDPOINTS.catalog.banks);
  return (Array.isArray(res) ? res : []).map((dto) => ({
    id: str(dto.id),
    name: str(dto.name),
    description: str(dto.description),
    questionCount: num(dto.questionCount),
  }));
}

/** 读取题库详情（含题目清单与统计）。 */
export async function loadBank(
  id: string,
  client: QuestionClient = httpClient,
): Promise<AdminBankDetail> {
  const res = await client.get<Dto>(`${ENDPOINTS.catalog.banks}/${id}`);
  return toBankDetail(res);
}

/** 题库详情 DTO → 前端口径。 */
export function toBankDetail(dto: Dto): AdminBankDetail {
  const bank = (dto.bank ?? {}) as Dto;
  const stats = (dto.statistics ?? {}) as Dto;
  return {
    bank: {
      id: str(bank.id),
      name: str(bank.name),
      description: str(bank.description),
      questionCount: num(bank.questionCount),
    },
    questions: Array.isArray(dto.questions)
      ? (dto.questions as Dto[]).map(toQuestionSummary)
      : [],
    statistics: {
      total: num(stats.total),
      draft: num(stats.draft),
      published: num(stats.published),
      disabled: num(stats.disabled),
      objectiveCount: num(stats.objectiveCount),
      objectiveScore: num(stats.objectiveScore),
      subjectiveCount: num(stats.subjectiveCount),
      subjectiveScore: num(stats.subjectiveScore),
    },
  };
}

/** 新建题库。 */
export async function createBank(
  input: { name: string; description: string },
  client: QuestionClient = httpClient,
): Promise<AdminBankDetail> {
  const res = await client.post<Dto>(ENDPOINTS.catalog.banks, {
    name: input.name,
    description: input.description,
  });
  return toBankDetail(res);
}

/** 修改题库。 */
export async function updateBank(
  id: string,
  input: { name: string; description: string },
  client: QuestionClient = httpClient,
): Promise<AdminBankDetail> {
  const res = await client.put<Dto>(`${ENDPOINTS.catalog.banks}/${id}`, {
    name: input.name,
    description: input.description,
  });
  return toBankDetail(res);
}

/** 删除题库。 */
export async function deleteBank(id: string, client: QuestionClient = httpClient): Promise<void> {
  await client.delete(`${ENDPOINTS.catalog.banks}/${id}`);
}

/** 批量把题目加入题库。 */
export async function addBankItems(
  id: string,
  questionIds: string[],
  client: QuestionClient = httpClient,
): Promise<AdminBankDetail> {
  const res = await client.post<Dto>(`${ENDPOINTS.catalog.banks}/${id}/items`, {
    questionIds: questionIds.map(Number),
  });
  return toBankDetail(res);
}

/** 批量把题目移出题库（题目本身不受影响）。 */
export async function removeBankItems(
  id: string,
  questionIds: string[],
  client: QuestionClient = httpClient,
): Promise<AdminBankDetail> {
  const res = await client.delete<Dto>(`${ENDPOINTS.catalog.banks}/${id}/items`, {
    questionIds: questionIds.map(Number),
  });
  return toBankDetail(res);
}
