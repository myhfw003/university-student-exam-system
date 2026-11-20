/* ==========================================================================
   知行测评 · 练习开放单（管理端）
   --------------------------------------------------------------------------
   管理端对**练习开放单**的读写：列表、新建、改设置、上架、下架。

   开放单是独立于练习卷的聚合：它决定「这份练习开放给谁、开放多久」，
   而次数上限 / 反馈时机 / 错题回流这些练习规则挂在**练习卷**上，
   所以这里没有、也不该有规则字段。

   后端契约（`docs/api/openapi.json`）：
   - `GET    /api/v1/practice-assignments?keyword=&status=&page=&size=`
   - `POST   /api/v1/practice-assignments`
   - `PUT    /api/v1/practice-assignments/{id}`
   - `POST   /api/v1/practice-assignments/{id}/publish`
   - `POST   /api/v1/practice-assignments/{id}/archive`

   **ID 都是数字主键**：前端一律用字符串，边界上转换（`Number(...)`）。
   ========================================================================== */

import { httpClient } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import {
  PRACTICE_ASSIGNMENT_STATUS_LABEL,
  type AdminPracticeAssignment,
  type PracticeAssignmentStatus,
} from "../domain/practice";

/** 开放单接口所需的最小客户端接口。 */
export type PracticeAssignmentClient = Pick<typeof httpClient, "get" | "post" | "put">;

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

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => str(item)) : [];
}

/** 可空的 ISO 时间串；null / 空串统一成 null（表示「不限」）。 */
function moment(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return str(value);
}

/** 映射练习开放单。 */
export function toPracticeAssignment(dto: Dto): AdminPracticeAssignment {
  const status = str(dto.status, "draft") as PracticeAssignmentStatus;
  return {
    id: str(dto.id),
    title: str(dto.title),
    paperId: str(dto.paperId),
    paperName: str(dto.paperName),
    questionCount: num(dto.questionCount),
    totalScore: num(dto.totalScore),
    status,
    // 中文名取自共享词表（与后端 `Label` 一致，CI 有校验），
    // 不用后端返回的 statusLabel：两边取同一份，免得 mock 与 HTTP 显示不同。
    statusLabel: PRACTICE_ASSIGNMENT_STATUS_LABEL[status] ?? status,
    scopeTagIds: strList(dto.scopeTagIds),
    scopeTagNames: strList(dto.scopeTagNames),
    openAt: moment(dto.openAt),
    closeAt: moment(dto.closeAt),
    publishedAt: moment(dto.publishedAt),
    createdAt: moment(dto.createdAt),
    attemptCount: num(dto.attemptCount),
  };
}

/** 列表查询参数。 */
export interface PracticeAssignmentListParams {
  /** 标题关键词。 */
  keyword?: string | undefined;
  /** 状态过滤；不传表示全部。 */
  status?: PracticeAssignmentStatus | undefined;
  /** 页码（1 起）。 */
  page?: number | undefined;
  /** 每页条数（后端夹在 1..100）。 */
  size?: number | undefined;
}

/** 列表返回。 */
export interface PracticeAssignmentPage {
  items: AdminPracticeAssignment[];
  total: number;
  page: number;
  size: number;
}

/** 读取开放单列表。 */
export async function loadPracticeAssignments(
  params: PracticeAssignmentListParams = {},
  client: PracticeAssignmentClient = httpClient,
): Promise<PracticeAssignmentPage> {
  const res = await client.get<{ items?: Dto[]; total?: number; page?: number; size?: number }>(
    ENDPOINTS.delivery.practiceAssignments,
    {
      query: {
        page: params.page ?? 1,
        size: params.size ?? 20,
        ...(params.keyword ? { keyword: params.keyword } : {}),
        ...(params.status ? { status: params.status } : {}),
      },
    },
  );
  const items = (res.items ?? []).map(toPracticeAssignment);
  return {
    items,
    total: num(res.total, items.length),
    page: num(res.page, params.page ?? 1),
    size: num(res.size, params.size ?? 20),
  };
}

/** 开放单的可写字段。 */
export interface PracticeAssignmentWriteInput {
  title: string;
  /** 开放范围：组织维度标签 ID（前端字符串，后端数字）。 */
  scopeTagIds: string[];
  /** 开放开始时间（ISO）；null 表示不限。 */
  openAt: string | null;
  /** 开放结束时间（ISO）；null 表示不限。 */
  closeAt: string | null;
}

/** 新建开放单：多一个「挂哪份练习卷」。 */
export interface PracticeAssignmentCreateInput extends PracticeAssignmentWriteInput {
  /** 练习卷 ID。 */
  paperId: string;
}

/** 请求体：ID 一律转成数字，标签 ID 也要。 */
function toWriteBody(input: PracticeAssignmentWriteInput): Record<string, unknown> {
  return {
    title: input.title.trim(),
    scopeTagIds: input.scopeTagIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)),
    openAt: input.openAt,
    closeAt: input.closeAt,
  };
}

/** 新建开放单（草稿）。 */
export async function createPracticeAssignment(
  input: PracticeAssignmentCreateInput,
  client: PracticeAssignmentClient = httpClient,
): Promise<AdminPracticeAssignment> {
  const dto = await client.post<Dto>(ENDPOINTS.delivery.practiceAssignments, {
    paperId: Number(input.paperId),
    ...toWriteBody(input),
  });
  return toPracticeAssignment(dto);
}

/**
 * 改开放单设置。
 *
 * **练习卷改不了**：后端的更新接口没有 paperId 字段，
 * 换卷等于换一条开放单。
 */
export async function updatePracticeAssignment(
  id: string,
  input: PracticeAssignmentWriteInput,
  client: PracticeAssignmentClient = httpClient,
): Promise<AdminPracticeAssignment> {
  const dto = await client.put<Dto>(`${ENDPOINTS.delivery.practiceAssignments}/${id}`, toWriteBody(input));
  return toPracticeAssignment(dto);
}

/** 上架开放单：上架后学生才能看见（且要在开放期内）。 */
export async function publishPracticeAssignment(
  id: string,
  client: PracticeAssignmentClient = httpClient,
): Promise<AdminPracticeAssignment> {
  const dto = await client.post<Dto>(`${ENDPOINTS.delivery.practiceAssignments}/${id}/publish`, {});
  return toPracticeAssignment(dto);
}

/** 下架开放单：下架后学生立刻看不见这份练习。 */
export async function archivePracticeAssignment(
  id: string,
  client: PracticeAssignmentClient = httpClient,
): Promise<AdminPracticeAssignment> {
  const dto = await client.post<Dto>(`${ENDPOINTS.delivery.practiceAssignments}/${id}/archive`, {});
  return toPracticeAssignment(dto);
}
