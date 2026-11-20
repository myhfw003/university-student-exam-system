/* ==========================================================================
   知行测评 · 管理端的用户、角色与审计
   --------------------------------------------------------------------------
   管理端三块共用这里的端点：

   - **用户与角色**：`/users`（列表带组织归属）、`/users/{id}`、`/users/{id}/roles`、
     `/users/{id}/tags`、`/users/import`、`/roles`；
   - **组织维度标签**：`/tags` 的 organization 分组（名单组的真实形态）；
   - **审计日志**：`/audit-logs`。

   口径说明：
   - 后端的状态是 `Active` / `Disabled` / `Locked`，前端统一归一化为小写。
   - 后端给的是**角色码**（`system_admin` / `student` …），改角色时要的是**角色 ID**，
     两者靠 `GET /roles` 对上。
   ========================================================================== */

import { httpClient } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import type {
  AdminAuditLog,
  AdminPermission,
  AdminRole,
  AdminUser,
  AdminUserImportResult,
  AdminUserOrganization,
  AdminUserStatus,
  OrgTag,
} from "../domain/admin";

/** 管理端接口所需的客户端。 */
export type AdminClient = Pick<typeof httpClient, "get" | "post" | "put" | "delete">;

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

function bool(value: unknown): boolean {
  return value === true;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => str(v)) : [];
}

function numList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

/** 后端状态（`Active` / `Disabled` / `Locked`）→ 前端口径。 */
export function toUserStatus(value: unknown): AdminUserStatus {
  switch (str(value).toLowerCase()) {
    case "disabled":
      return "disabled";
    case "locked":
      return "locked";
    default:
      return "active";
  }
}

/** 用户摘要 DTO → 管理端用户条目。 */
export function toAdminUser(dto: Dto, extra?: Partial<AdminUser>): AdminUser {
  return {
    id: str(dto.id),
    username: str(dto.username),
    displayName: str(dto.displayName),
    email: str(dto.email),
    phone: str(dto.phone),
    status: toUserStatus(dto.status),
    mustChangePassword: bool(dto.mustChangePassword),
    roles: strList(dto.roles),
    roleIds: numList(dto.roleIds),
    organizationTagIds: numList(dto.organizationTagIds),
    organizationPath: str(dto.organizationPath),
    createdAt: str(dto.createdAt),
    lastLoginAt: dto.lastLoginAt ? str(dto.lastLoginAt) : null,
    ...extra,
  };
}

/* ------------------------------------------------------------ 组织维度标签 */

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

/* ------------------------------------------------------------------ 用户 */

/** 用户列表的一页。 */
export interface AdminUserPage {
  items: AdminUser[];
  /** 命中总数。 */
  total: number;
}

/** 读取用户列表（服务端分页与过滤）。 */
export async function loadUserPage(
  params: {
    keyword?: string | undefined;
    status?: string | undefined;
    roleId?: string | undefined;
    page?: number | undefined;
    size?: number | undefined;
  } = {},
  client: AdminClient = httpClient,
): Promise<AdminUserPage> {
  const res = await client.get<{
    items?: Dto[];
    total?: number;
    organizations?: Array<{ userId?: number; tagIds?: number[]; organizationPath?: string | null }>;
  }>(ENDPOINTS.admin.users, {
    query: {
      page: params.page ?? 1,
      size: params.size ?? 50,
      ...(params.keyword ? { keyword: params.keyword } : {}),
      ...(params.status && params.status !== "all" ? { status: params.status } : {}),
      ...(params.roleId ? { roleId: params.roleId } : {}),
    },
  });

  // 组织归属与用户条目平行返回：按用户 ID 对上号再合并。
  const organizationByUser = new Map<string, { tagIds: string[]; path: string }>();
  for (const org of res.organizations ?? []) {
    organizationByUser.set(String(org.userId ?? ""), {
      tagIds: numList(org.tagIds),
      path: str(org.organizationPath),
    });
  }

  const items = (res.items ?? []).map((dto) => {
    const org = organizationByUser.get(str(dto.id));
    return toAdminUser(dto, {
      organizationTagIds: org?.tagIds ?? [],
      organizationPath: org?.path ?? "",
    });
  });

  return { items, total: num(res.total, items.length) };
}

/** 读取用户详情（档案 + 角色 ID + 权限点）。 */
export async function loadAdminUser(id: string, client: AdminClient = httpClient): Promise<AdminUser> {
  const res = await client.get<Dto>(`${ENDPOINTS.admin.users}/${id}`);
  const user = (res.user ?? res) as Dto;
  return toAdminUser(user, { roleIds: numList(res.roleIds) });
}

/** 修改用户档案与状态。 */
export async function updateAdminUser(
  id: string,
  input: {
    displayName: string;
    email: string;
    phone: string;
    status: AdminUserStatus;
    disableReason?: string;
  },
  client: AdminClient = httpClient,
): Promise<AdminUser> {
  const res = await client.put<Dto>(`${ENDPOINTS.admin.users}/${id}`, {
    displayName: input.displayName,
    email: input.email,
    phone: input.phone,
    status: input.status,
    // 不给停用原因时让后端自己填「管理员禁用」，别发空串把默认值盖掉。
    ...(input.disableReason ? { disableReason: input.disableReason } : {}),
  });
  const user = (res.user ?? res) as Dto;
  return toAdminUser(user, { roleIds: numList(res.roleIds) });
}

/** 覆盖式设置用户的角色集合（给的是角色 ID）。 */
export async function assignUserRoles(
  id: string,
  roleIds: string[],
  client: AdminClient = httpClient,
): Promise<AdminUser> {
  const res = await client.put<Dto>(`${ENDPOINTS.admin.users}/${id}/roles`, {
    roleIds: roleIds.map(Number),
  });
  const user = (res.user ?? res) as Dto;
  return toAdminUser(user, { roleIds: numList(res.roleIds) });
}

/** 撤销用户的某个角色。 */
export async function revokeUserRole(
  id: string,
  roleId: string,
  client: AdminClient = httpClient,
): Promise<void> {
  await client.delete(`${ENDPOINTS.admin.users}/${id}/roles/${roleId}`);
}

/** 读取用户的组织归属。 */
export async function loadUserOrganization(
  id: string,
  client: AdminClient = httpClient,
): Promise<AdminUserOrganization> {
  const res = await client.get<{
    userId?: number;
    tags?: Dto[];
    organizationPath?: string | null;
  }>(ENDPOINTS.admin.userTags(id));

  return {
    userId: str(res.userId, id),
    tags: (res.tags ?? []).map((dto) => ({
      id: str(dto.id),
      code: str(dto.code),
      name: str(dto.name),
      path: str(dto.path),
    })),
    path: str(res.organizationPath),
  };
}

/** 覆盖式设置用户挂载的组织维度标签。 */
export async function assignUserTags(
  id: string,
  tagIds: string[],
  client: AdminClient = httpClient,
): Promise<AdminUserOrganization> {
  const res = await client.put<{
    userId?: number;
    tags?: Dto[];
    organizationPath?: string | null;
  }>(ENDPOINTS.admin.userTags(id), { tagIds: tagIds.map(Number) });

  return {
    userId: str(res.userId, id),
    tags: (res.tags ?? []).map((dto) => ({
      id: str(dto.id),
      code: str(dto.code),
      name: str(dto.name),
      path: str(dto.path),
    })),
    path: str(res.organizationPath),
  };
}

/** 用户总数（管理端概览用）。 */
export async function countUsers(client: AdminClient = httpClient): Promise<number> {
  const res = await client.get<{ total?: number }>(ENDPOINTS.admin.users, {
    query: { page: 1, size: 1 },
  });
  return num(res.total);
}

/* ------------------------------------------------------------ 名单批量导入 */

/**
 * 上传名单 CSV 并导入。
 *
 * 逐行处理：单行出错只跳过该行并记录原因，不阻断整批。
 * 返回值里的初始密码只在这里回显一次，管理员据此分发。
 */
export async function importUserRoster(
  file: File,
  client: AdminClient = httpClient,
): Promise<AdminUserImportResult> {
  const form = new FormData();
  form.append("file", file, file.name);

  const res = await client.post<{
    total?: number;
    succeeded?: number;
    created?: number;
    updated?: number;
    failed?: Array<{ rowNumber?: number; username?: string | null; reason?: string }>;
    generatedPasswords?: Array<{ username?: string; password?: string }>;
  }>(`${ENDPOINTS.admin.users}/import`, form);

  return {
    total: num(res.total),
    succeeded: num(res.succeeded),
    created: num(res.created),
    updated: num(res.updated),
    failures: (res.failed ?? []).map((f) => ({
      rowNumber: num(f.rowNumber),
      username: str(f.username),
      reason: str(f.reason),
    })),
    generatedPasswords: (res.generatedPasswords ?? []).map((p) => ({
      username: str(p.username),
      password: str(p.password),
    })),
  };
}

/* ------------------------------------------------------------------ 角色 */

/** 读取全部角色及其权限点。 */
export async function loadRoles(client: AdminClient = httpClient): Promise<AdminRole[]> {
  const res = await client.get<Dto[]>(ENDPOINTS.admin.roles);
  return (Array.isArray(res) ? res : []).map((dto) => ({
    id: str(dto.id),
    code: str(dto.code),
    name: str(dto.name),
    description: str(dto.description),
    isSystem: bool(dto.isSystem),
    permissions: strList(dto.permissions),
  }));
}

/** 读取权限点目录（管理端角色权限矩阵用）。 */
export async function loadPermissions(
  client: AdminClient = httpClient,
): Promise<AdminPermission[]> {
  const res = await client.get<Dto[]>(ENDPOINTS.admin.permissions);
  return (Array.isArray(res) ? res : []).map((dto) => ({
    code: str(dto.code),
    name: str(dto.name),
    module: str(dto.module),
    description:
      dto.description === null || dto.description === undefined ? null : str(dto.description),
  }));
}

/**
 * 修改角色的名称、说明与权限集合。
 *
 * 权限集合是**整体覆盖**（不是增量）：传什么就是什么，
 * 少传一个权限点，那个权限点就没了。
 */
export async function updateRole(
  id: string,
  input: { name: string; description: string; permissionCodes: string[] },
  client: AdminClient = httpClient,
): Promise<AdminRole> {
  const res = await client.put<Dto>(`${ENDPOINTS.admin.roles}/${id}`, {
    name: input.name,
    description: input.description,
    permissionCodes: input.permissionCodes,
  });
  return {
    id: str(res.id),
    code: str(res.code),
    name: str(res.name),
    description: str(res.description),
    isSystem: bool(res.isSystem),
    permissions: strList(res.permissions),
  };
}

/* -------------------------------------------------------------- 审计日志 */

/** 审计日志的一页。 */
export interface AdminAuditPage {
  items: AdminAuditLog[];
  total: number;
}

/** 读取审计日志（服务端按动作 / 对象 / 时间范围过滤）。 */
export async function loadAuditLogs(
  params: {
    action?: string | undefined;
    targetType?: string | undefined;
    targetId?: string | undefined;
    operatorId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    page?: number | undefined;
    size?: number | undefined;
  } = {},
  client: AdminClient = httpClient,
): Promise<AdminAuditPage> {
  const res = await client.get<{ items?: Dto[]; total?: number }>(ENDPOINTS.admin.auditLogs, {
    query: {
      page: 1,
      size: 50,
      ...(params.action && params.action !== "all" ? { action: params.action } : {}),
      ...(params.targetType ? { targetType: params.targetType } : {}),
      ...(params.targetId ? { targetId: params.targetId } : {}),
      ...(params.operatorId ? { operatorId: params.operatorId } : {}),
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
    },
  });

  const items = (res.items ?? []).map((dto) => ({
    id: str(dto.id),
    at: str(dto.occurredAt),
    operatorId: dto.operatorId === null || dto.operatorId === undefined ? null : str(dto.operatorId),
    operator: str(dto.operatorName, "系统"),
    action: str(dto.action),
    targetType: str(dto.targetType),
    targetId: str(dto.targetId),
    summary: str(dto.summary),
    ip: str(dto.ipAddress),
    userAgent: str(dto.userAgent),
  }));

  return { items, total: num(res.total, items.length) };
}
