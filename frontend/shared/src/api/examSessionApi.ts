/* ==========================================================================
   知行测评 · 考试场次（学生视角）
   --------------------------------------------------------------------------
   场次是「考试安排」的单位：什么时候开、考多久、考哪份卷。
   学生只能读到与自己相关的场次（名单内 + 全员开放已发布），
   范围判定在后端完成——这里只负责把返回结果映射成前端口径。
   ========================================================================== */

import { ENDPOINTS } from "./endpoints";
import { httpClient } from "./httpClient";
import type { CatalogClient } from "./catalogApi";
import type { AttemptRules } from "../domain/attempt";

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
  variantRule?: string;
  variantRuleLabel?: string;
  publishedAt?: string | null;
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

function toSummary(dto: SessionDto): ExamSessionSummary {
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
