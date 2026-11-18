/* ==========================================================================
   知行测评 · 监考处置的后端读写
   --------------------------------------------------------------------------
   处置是**按 attempt 维度**的：警告 / 备注 / 强制交卷都落到某一次作答上，
   所以调用方必须带上 attemptId（监考快照的候选人条目里有）。

   强制交卷会由后端真正结束该次作答并记审计，前端不自己改状态——
   本地改了状态，下一次轮询就会被服务端的状态盖回去。
   ========================================================================== */

import { ENDPOINTS } from "./endpoints";
import { httpClient } from "./httpClient";
import type { ProctorActionEntry, ProctorActionKind } from "../domain/review";

/** 监考接口所需的客户端。 */
export type ProctorClient = Pick<typeof httpClient, "get" | "post">;

type Dto = Record<string, unknown>;

function str(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/** 处置类型 → 前端口径。 */
export function toProctorActionKind(value: unknown): ProctorActionKind {
  switch (str(value)) {
    case "note":
      return "note";
    case "force_submit":
      return "force_submit";
    default:
      return "warn";
  }
}

/** 监考处置 DTO → 前端口径。 */
export function toProctorAction(dto: Dto): ProctorActionEntry {
  return {
    id: str(dto.id),
    attemptId: str(dto.attemptId),
    kind: toProctorActionKind(dto.actionType),
    message: str(dto.message),
    reason: str(dto.reason),
    operator: str(dto.operatorName, "系统"),
    createdAt: str(dto.createdAt),
  };
}

/**
 * 下发一条监考处置。
 *
 * @param attemptId 处置落到的那一次作答。
 * @param kind 警告 / 备注 / 强制交卷。
 * @param reason 处置原因（教师留痕）；强制交卷必须填。
 * @param message 下发给考生的内容；不填时用原因。
 */
export async function createProctorAction(
  attemptId: string,
  input: { kind: ProctorActionKind; reason: string; message?: string },
  client: ProctorClient = httpClient,
): Promise<ProctorActionEntry> {
  const res = await client.post<Dto>(ENDPOINTS.delivery.attemptProctorActions(attemptId), {
    actionType: input.kind,
    message: input.message ?? input.reason,
    reason: input.reason,
  });
  return toProctorAction(res);
}

/** 读取一次作答的处置历史。 */
export async function loadProctorActions(
  attemptId: string,
  client: ProctorClient = httpClient,
): Promise<ProctorActionEntry[]> {
  const res = await client.get<{ items?: Dto[] }>(
    ENDPOINTS.delivery.attemptProctorActions(attemptId),
  );
  return (res.items ?? []).map(toProctorAction);
}
