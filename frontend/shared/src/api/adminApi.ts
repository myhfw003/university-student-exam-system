/* ==========================================================================
   知行测评 · 管理端的组织标签与用户
   --------------------------------------------------------------------------
   两样东西是管理端各处都要用的：

   - **组织维度标签**（院系 → 专业 → 班级）：场次名单按它纳入，
     用户档案也挂它。内容目录里的标签不含这一维度（组织标签只挂用户），
     管理端要单独读。
   - **用户摘要**：指定考生时逐个勾选用。
   ========================================================================== */

import { httpClient } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import type { OrgTag, UserSummary } from "../domain/admin";

/** 管理端接口所需的客户端。 */
export type AdminClient = Pick<typeof httpClient, "get" | "post" | "put">;

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

/**
 * 读取组织维度标签（院系 / 专业 / 班级）。
 *
 * 按父子关系返回——树状展示要靠 parentId 自己拼。
 */
export async function loadOrgTags(client: AdminClient = httpClient): Promise<OrgTag[]> {
  const res = await client.get<{
    groups?: Array<{ group?: string; tags?: Dto[] }>;
  } | Dto[]>(ENDPOINTS.catalog.tags);

  const groups = Array.isArray(res) ? [] : (res.groups ?? []);
  const organization = groups.find((group) => group.group === "organization");
  const tags = organization?.tags ?? [];

  return tags.map((dto) => ({
    id: String(dto.id ?? ""),
    code: str(dto.code),
    name: str(dto.name),
    parentId: dto.parentId === null || dto.parentId === undefined ? null : String(dto.parentId),
  }));
}

/** 读取用户摘要（指定考生时勾选用）。 */
export async function loadUsers(
  params: { keyword?: string } = {},
  client: AdminClient = httpClient,
): Promise<UserSummary[]> {
  const res = await client.get<{ items?: Dto[] } | Dto[]>(ENDPOINTS.admin.users, {
    query: { page: 1, size: 200, ...(params.keyword ? { keyword: params.keyword } : {}) },
  });
  const items = Array.isArray(res) ? res : (res.items ?? []);
  return items.map((dto) => ({
    id: String(dto.id ?? ""),
    username: str(dto.username),
    displayName: str(dto.displayName),
    status: str(dto.status),
    roles: Array.isArray(dto.roles) ? dto.roles.map((r) => str(r)) : [],
  }));
}

/** 用户总数（管理端概览用）。 */
export async function countUsers(client: AdminClient = httpClient): Promise<number> {
  const res = await client.get<{ total?: number }>(ENDPOINTS.admin.users, {
    query: { page: 1, size: 1 },
  });
  return num(res.total);
}
