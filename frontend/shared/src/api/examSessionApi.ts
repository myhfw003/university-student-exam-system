/* ==========================================================================
   知行测评 · 考试场次的后端读取与写入
   --------------------------------------------------------------------------
   场次是「考试安排」的单位：什么时候开、考多久、考哪份卷、谁可以考。

   学生端与管理端读的是同一批端点，差别只在用哪几个：
   - 学生端：`GET /exam-sessions`（后端已按对象级范围过滤）、`GET /exam-sessions/{id}`；
   - 管理端：场次 CRUD、发布 / 关闭 / 取消、名单、成绩、负责人。

   可见性判定都在后端：这里拿到的就是能看的全部。
   ========================================================================== */

import { ENDPOINTS } from "./endpoints";
import { httpClient } from "./httpClient";
import type { CatalogClient } from "./catalogApi";
import type { AttemptRules } from "../domain/attempt";
import type {
  AdminSessionDetail,
  AdminSessionRules,
  AdminSessionSummary,
  SessionAssignment,
  SessionGrade,
  SessionParticipant,
} from "../domain/admin";

/** 场次状态（与后端 ExamSessionStatuses 一致）。 */
export type ExamSessionStatus = "scheduled" | "in_progress" | "closed" | "cancelled";

/** 学生可见的考试场次。 */
export interface ExamSessionSummary {
  id: string;
  name: string;
  paperId: string;
  paperName: string;
  status: ExamSessionStatus;
  statusLabel: string;
  openAt: string;
  closeAt: string;
  durationMinutes: number;
  participantMode: string;
  variantRule: string;
  variantRuleLabel: string;
  publishedAt: string | null;
}

interface SessionDto {
  id?: string | number;
  name?: string;
  paperId?: string | number;
  paperName?: string;
  status?: string;
  statusLabel?: string;
  openAt?: string;
  closeAt?: string;
  durationMinutes?: number;
  participantMode?: string;
  participantModeLabel?: string;
  variantRule?: string;
  variantRuleLabel?: string;
  publishedAt?: string | null;
  createdAt?: string;
}

function toStatus(value: string | undefined): ExamSessionStatus {
  switch (value) {
    case "in_progress":
      return "in_progress";
    case "closed":
      return "closed";
    case "cancelled":
      return "cancelled";
    default:
      return "scheduled";
  }
}

/** 映射场次摘要。 */
export function toSummary(dto: SessionDto): ExamSessionSummary {
  return {
    id: String(dto.id ?? ""),
    name: dto.name ?? "",
    paperId: String(dto.paperId ?? ""),
    paperName: dto.paperName ?? "",
    status: toStatus(dto.status),
    statusLabel: dto.statusLabel ?? "",
    openAt: dto.openAt ?? "",
    closeAt: dto.closeAt ?? "",
    durationMinutes: dto.durationMinutes ?? 0,
    participantMode: dto.participantMode ?? "",
    variantRule: dto.variantRule ?? "standard",
    variantRuleLabel: dto.variantRuleLabel ?? "",
    publishedAt: dto.publishedAt ?? null,
  };
}

/**
 * 读取当前调用者可见的考试场次。
 * <para>后端已按对象级范围过滤：这里拿到的就是能看的全部。</para>
 */
export async function loadMyExamSessions(
  client: CatalogClient = httpClient,
): Promise<ExamSessionSummary[]> {
  const res = await client.get<{ items?: SessionDto[] } | SessionDto[]>(
    ENDPOINTS.delivery.examSessions,
    { query: { page: 1, size: 200 } },
  );

  const items = Array.isArray(res) ? res : (res.items ?? []);
  return items.map(toSummary);
}

/** 场次详情：考试规则与考生须知都在这里。 */
export interface ExamSessionDetail {
  id: string;
  name: string;
  paperId: string;
  paperName: string;
  status: ExamSessionStatus;
  statusLabel: string;
  openAt: string;
  closeAt: string;
  durationMinutes: number;
  participantMode: string;
  variantRule: string;
  variantRuleLabel: string;
  /** 考生须知。 */
  note: string;
  /** 考试规则（切屏上限、心跳间隔等）。 */
  rules: AttemptRules;
}

/** 后端场次详情 DTO。 */
interface SessionDetailDto {
  session?: SessionDto;
  rules?: Record<string, unknown>;
  note?: string | null;
}

function toRules(dto: Record<string, unknown> | undefined): AttemptRules {
  const rules = dto ?? {};
  const maxFocusLoss = rules.maxFocusLoss;
  return {
    maxFocusLoss: typeof maxFocusLoss === "number" ? maxFocusLoss : null,
    onMaxFocusLoss: typeof rules.onMaxFocusLoss === "string" ? rules.onMaxFocusLoss : "force_submit",
    requireFullScreen: rules.requireFullScreen === true,
    blockCopyPaste: rules.blockCopyPaste === true,
    blockContextMenu: rules.blockContextMenu === true,
    showWatermark: rules.showWatermark === true,
    enableHeartbeatCheck: rules.enableHeartbeatCheck === true,
    heartbeatIntervalSeconds:
      typeof rules.heartbeatIntervalSeconds === "number" ? rules.heartbeatIntervalSeconds : 30,
    heartbeatTimeoutSeconds:
      typeof rules.heartbeatTimeoutSeconds === "number" ? rules.heartbeatTimeoutSeconds : 90,
    maxDisconnect: typeof rules.maxDisconnect === "number" ? rules.maxDisconnect : 3,
    earlyEntryMinutes: typeof rules.earlyEntryMinutes === "number" ? rules.earlyEntryMinutes : 0,
  };
}

/**
 * 读取一场考试场次的详情。
 *
 * 答题页要用到两样列表里没有的东西：考试规则（切屏上限、心跳间隔）
 * 与考生须知（考试须知区块）。
 */
export async function loadExamSession(
  id: string,
  client: CatalogClient = httpClient,
): Promise<ExamSessionDetail> {
  const dto = await client.get<SessionDetailDto>(`${ENDPOINTS.delivery.examSessions}/${id}`);
  const session = dto.session ?? {};
  const summary = toSummary(session);

  return {
    ...summary,
    note: dto.note ?? "",
    rules: toRules(dto.rules),
  };
}


/* ==========================================================================
   管理端
   ========================================================================== */

/** 管理端场次摘要（比学生端多两个展示字段）。 */
function toAdminSummary(dto: SessionDto): AdminSessionSummary {
  return {
    ...toSummary(dto),
    participantModeLabel: dto.participantModeLabel ?? "",
    createdAt: dto.createdAt ?? "",
  };
}

/** 映射考试规则。 */
function toAdminRules(dto: Record<string, unknown> | undefined): AdminSessionRules {
  const rules = dto ?? {};
  const maxFocusLoss = rules.maxFocusLoss;
  return {
    maxFocusLoss: typeof maxFocusLoss === "number" ? maxFocusLoss : null,
    onMaxFocusLoss: typeof rules.onMaxFocusLoss === "string" ? rules.onMaxFocusLoss : "force_submit",
    requireFullScreen: rules.requireFullScreen === true,
    blockCopyPaste: rules.blockCopyPaste === true,
    blockContextMenu: rules.blockContextMenu === true,
    showWatermark: rules.showWatermark === true,
    enableHeartbeatCheck: rules.enableHeartbeatCheck === true,
    heartbeatIntervalSeconds:
      typeof rules.heartbeatIntervalSeconds === "number" ? rules.heartbeatIntervalSeconds : 30,
    heartbeatTimeoutSeconds:
      typeof rules.heartbeatTimeoutSeconds === "number" ? rules.heartbeatTimeoutSeconds : 90,
    maxDisconnect: typeof rules.maxDisconnect === "number" ? rules.maxDisconnect : 3,
    earlyEntryMinutes: typeof rules.earlyEntryMinutes === "number" ? rules.earlyEntryMinutes : 0,
  };
}

/** 映射场次详情。 */
function toAdminDetail(dto: Record<string, unknown>): AdminSessionDetail {
  const session = (dto.session ?? {}) as SessionDto;
  return {
    summary: toAdminSummary(session),
    rules: toAdminRules(dto.rules as Record<string, unknown> | undefined),
    note: typeof dto.note === "string" ? dto.note : "",
    participantTagIds: Array.isArray(dto.participantTagIds)
      ? dto.participantTagIds.map((v) => String(v))
      : [],
    participantUserIds: Array.isArray(dto.participantUserIds)
      ? dto.participantUserIds.map((v) => String(v))
      : [],
  };
}

/** 管理端场次写入参数。 */
export interface AdminSessionWrite {
  name: string;
  openAt: string;
  closeAt: string;
  durationMinutes: number;
  participantMode: string;
  participantTagIds: string[];
  participantUserIds: string[];
  /** 卷型规则；null 表示沿用来源试卷的卷型。 */
  variantRule: string | null;
  rules: AdminSessionRules | null;
  note: string;
}

/** 管理端场次新建参数（多一个来源试卷）。 */
export interface AdminSessionCreate extends AdminSessionWrite {
  paperId: string;
}

/** 管理端接口所需的客户端。 */
export type ExamSessionAdminClient = Pick<typeof httpClient, "get" | "post" | "put">;

/**
 * 读取管理端的场次列表。
 *
 * 状态与关键词交给服务端过滤——场次可能有几百场，前端不该全拉回来自己筛。
 */
export async function loadAdminSessions(
  params: { status?: string; keyword?: string } = {},
  client: ExamSessionAdminClient = httpClient,
): Promise<AdminSessionSummary[]> {
  const res = await client.get<{ items?: SessionDto[] } | SessionDto[]>(
    ENDPOINTS.delivery.examSessions,
    {
      query: {
        page: 1,
        size: 200,
        ...(params.status && params.status !== "all" ? { status: params.status } : {}),
        ...(params.keyword ? { keyword: params.keyword } : {}),
      },
    },
  );
  const items = Array.isArray(res) ? res : (res.items ?? []);
  return items.map(toAdminSummary);
}

/** 读取场次详情。 */
export async function loadAdminSession(
  id: string,
  client: ExamSessionAdminClient = httpClient,
): Promise<AdminSessionDetail> {
  const dto = await client.get<Record<string, unknown>>(`${ENDPOINTS.delivery.examSessions}/${id}`);
  return toAdminDetail(dto);
}

/** 新建场次。 */
export async function createAdminSession(
  input: AdminSessionCreate,
  client: ExamSessionAdminClient = httpClient,
): Promise<AdminSessionDetail> {
  const dto = await client.post<Record<string, unknown>>(ENDPOINTS.delivery.examSessions, {
    paperId: Number(input.paperId),
    name: input.name,
    openAt: input.openAt,
    closeAt: input.closeAt,
    durationMinutes: input.durationMinutes,
    participantMode: input.participantMode,
    participantTagIds: input.participantTagIds.map(Number),
    participantUserIds: input.participantUserIds.map(Number),
    // 空串不是合法存储值：交给后端判 null，才能落到「沿用试卷卷型」。
    variantRule: input.variantRule || null,
    rules: input.rules,
    note: input.note,
  });
  return toAdminDetail(dto);
}

/** 修改场次配置（只有未发布的场次能改）。 */
export async function updateAdminSession(
  id: string,
  input: AdminSessionWrite,
  client: ExamSessionAdminClient = httpClient,
): Promise<AdminSessionDetail> {
  const dto = await client.put<Record<string, unknown>>(
    `${ENDPOINTS.delivery.examSessions}/${id}`,
    {
      name: input.name,
      openAt: input.openAt,
      closeAt: input.closeAt,
      durationMinutes: input.durationMinutes,
      participantMode: input.participantMode,
      participantTagIds: input.participantTagIds.map(Number),
      participantUserIds: input.participantUserIds.map(Number),
      variantRule: input.variantRule || null,
      rules: input.rules,
      note: input.note,
    },
  );
  return toAdminDetail(dto);
}

/** 发布场次（试卷必须已发布并有快照；名单在此刻物化）。 */
export async function publishAdminSession(
  id: string,
  client: ExamSessionAdminClient = httpClient,
): Promise<AdminSessionDetail> {
  const dto = await client.post<Record<string, unknown>>(
    `${ENDPOINTS.delivery.examSessions}/${id}/publish`,
  );
  return toAdminDetail(dto);
}

/** 关闭场次。 */
export async function closeAdminSession(
  id: string,
  client: ExamSessionAdminClient = httpClient,
): Promise<AdminSessionDetail> {
  const dto = await client.post<Record<string, unknown>>(
    `${ENDPOINTS.delivery.examSessions}/${id}/close`,
  );
  return toAdminDetail(dto);
}

/** 取消场次。 */
export async function cancelAdminSession(
  id: string,
  client: ExamSessionAdminClient = httpClient,
): Promise<AdminSessionDetail> {
  const dto = await client.post<Record<string, unknown>>(
    `${ENDPOINTS.delivery.examSessions}/${id}/cancel`,
  );
  return toAdminDetail(dto);
}

/** 读取场次名单（发布时物化的考生）。 */
export async function loadSessionParticipants(
  id: string,
  client: ExamSessionAdminClient = httpClient,
): Promise<SessionParticipant[]> {
  const res = await client.get<{ items?: Record<string, unknown>[] } | Record<string, unknown>[]>(
    `${ENDPOINTS.delivery.examSessions}/${id}/participants`,
  );
  const items = Array.isArray(res) ? res : (res.items ?? []);
  return items.map((dto) => ({
    userId: String(dto.userId ?? ""),
    username: String(dto.username ?? ""),
    displayName: String(dto.displayName ?? ""),
    status: String(dto.status ?? ""),
    statusLabel: String(dto.statusLabel ?? ""),
    attemptsUsed: Number(dto.attemptsUsed ?? 0),
  }));
}

/** 读取场次成绩（逐人明细）。 */
export async function loadSessionGrades(
  id: string,
  client: ExamSessionAdminClient = httpClient,
): Promise<SessionGrade[]> {
  const res = await client.get<{ items?: Record<string, unknown>[] } | Record<string, unknown>[]>(
    `${ENDPOINTS.delivery.examSessions}/${id}/grades`,
  );
  const items = Array.isArray(res) ? res : (res.items ?? []);
  return items.map((dto) => ({
    attemptId: String(dto.attemptId ?? ""),
    attemptNo: Number(dto.attemptNo ?? 1),
    userId: String(dto.userId ?? ""),
    studentUsername: String(dto.studentUsername ?? ""),
    studentDisplayName: String(dto.studentDisplayName ?? ""),
    objectiveScore: Number(dto.objectiveScore ?? 0),
    objectiveMax: Number(dto.objectiveMax ?? 0),
    totalScore: Number(dto.totalScore ?? 0),
    totalMax: Number(dto.totalMax ?? 0),
    subjectivePending: dto.subjectivePending === true,
    gradeVisibility: String(dto.gradeVisibility ?? ""),
    published: dto.published === true,
    submittedAt: dto.submittedAt ? String(dto.submittedAt) : null,
  }));
}

/** 读取场次负责人。 */
export async function loadSessionAssignments(
  id: string,
  client: ExamSessionAdminClient = httpClient,
): Promise<SessionAssignment[]> {
  const res = await client.get<{ items?: Record<string, unknown>[] } | Record<string, unknown>[]>(
    `${ENDPOINTS.delivery.examSessions}/${id}/assignments`,
  );
  const items = Array.isArray(res) ? res : (res.items ?? []);
  return items.map((dto) => ({
    userId: String(dto.userId ?? ""),
    username: String(dto.username ?? ""),
    displayName: String(dto.displayName ?? ""),
    assignedAt: String(dto.assignedAt ?? ""),
  }));
}

/** 设置场次负责人（覆盖式）。 */
export async function setSessionAssignments(
  id: string,
  userIds: string[],
  client: ExamSessionAdminClient = httpClient,
): Promise<SessionAssignment[]> {
  const res = await client.put<{ items?: Record<string, unknown>[] } | Record<string, unknown>[]>(
    `${ENDPOINTS.delivery.examSessions}/${id}/assignments`,
    { userIds: userIds.map(Number) },
  );
  const items = Array.isArray(res) ? res : (res.items ?? []);
  return items.map((dto) => ({
    userId: String(dto.userId ?? ""),
    username: String(dto.username ?? ""),
    displayName: String(dto.displayName ?? ""),
    assignedAt: String(dto.assignedAt ?? ""),
  }));
}
