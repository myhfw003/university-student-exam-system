/* ==========================================================================
   知行测评 · 管理端用户数据通路
   --------------------------------------------------------------------------
   用户管理、角色分配、组织归属与名单导入各有一份 mock / HTTP 实现，
   页面只认这里定义的形状。

   三处口径差异要注意（页面不知道，数据通路知道）：

   1. **状态**：mock 是 `active` / `disabled`；真实后端是 `Active` / `Disabled` /
      `Locked`，这里归一化为小写。
   2. **角色**：mock 存的是**角色码**；真实后端给列表的是角色码，
      但改角色时接口要的是**角色 ID**——两者靠 `GET /roles` 对上。
   3. **组织归属**：mock 存的是标签 ID 数组；真实后端由标签树推导**完整路径**，
      标签本身在 `GET /tags` 的 organization 分组里。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  assignUserRoles,
  assignUserTags,
  createRole as createRoleApi,
  importUserRoster,
  isBackendEnabled,
  loadOrgTags,
  loadPermissions,
  loadRoles,
  loadUserPage,
  updateAdminUser,
  updateRole,
} from "@exam/shared/api";
import type {
  AdminPermission,
  AdminRole,
  AdminUserStatus,
  OrgTag,
} from "@exam/shared/domain/admin";
import type { AuditAction, UserRole } from "@exam/shared/domain/types";
import {
  USER_ROLE_LABEL,
  createRole,
  setRolePermissions,
  setUserRoles,
  updateUser,
  useAdminOps,
  writeAudit,
} from "@exam/shared/mock/adminOps";
import {
  PERMISSION_DISPLAY_NAMES,
  permissionModule,
  type PermissionPoint,
} from "@exam/shared/auth/permissions";
import {
  importRoster,
  type RosterImportResult,
  type RosterPreviewRow,
} from "@exam/shared/mock/roster";

/** 内置角色码（mock 模式用；HTTP 模式以 `GET /roles` 为准）。 */
export const BUILTIN_ROLE_CODES: UserRole[] = [
  "system_admin",
  "content_admin",
  "author_teacher",
  "grader_teacher",
  "student",
  "general_user",
];

/** 用户清单的一行（mock 与 HTTP 同一形状）。 */
export interface AdminUserRow {
  id: string;
  /** 登录账号。 */
  account: string;
  /** 姓名。 */
  name: string;
  email: string;
  status: AdminUserStatus;
  /** 是否要求下次登录修改密码。 */
  mustChangePassword: boolean;
  /** 角色码。 */
  roles: string[];
  /** 角色中文名。 */
  roleLabels: string[];
  /** 组织维度标签。 */
  orgTags: Array<{ id: string; name: string }>;
  /** 完整组织路径；社会人士为空。 */
  orgPath: string;
  lastLoginAt: string | null;
}

/* ------------------------------------------------------------------ 角色 */

/**
 * 角色目录。
 *
 * HTTP 模式读 `GET /roles`：角色码 → 角色 ID 的对照表只有这里有。
 */
export function useAdminRoles(): {
  roles: AdminRole[];
  byCode: Record<string, AdminRole>;
  loading: boolean;
  /** 重新拉角色目录（改了角色权限后要重拉）。 */
  refresh: () => void;
} {
  const remote = isBackendEnabled();
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const list = await loadRoles();
        if (!cancelled) setRoles(list);
      } catch {
        if (!cancelled) setRoles([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, token]);

  const mockRolePermissions = useAdminOps((state) => state.rolePermissions);
  const mockCustomRoles = useAdminOps((state) => state.customRoles);

  const effective = useMemo<AdminRole[]>(() => {
    if (remote) return roles;
    return [
      ...BUILTIN_ROLE_CODES.map((code) => ({
        id: code,
        code,
        name: USER_ROLE_LABEL[code],
        description: "",
        isSystem: true,
        permissions: mockRolePermissions[code] ?? [],
      })),
      // 自定义角色：mock 模式下新建出来的。
      ...mockCustomRoles,
    ];
  }, [remote, roles, mockRolePermissions, mockCustomRoles]);

  const byCode = useMemo(() => {
    const map: Record<string, AdminRole> = {};
    for (const role of effective) map[role.code] = role;
    return map;
  }, [effective]);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  return { roles: effective, byCode, loading, refresh };
}

/* ------------------------------------------------------------ 权限点 */

/** mock 模式用的权限点目录：中文名取自前端词表，模块取权限码前缀。 */
const MOCK_PERMISSION_CATALOG: AdminPermission[] = (
  Object.keys(PERMISSION_DISPLAY_NAMES) as PermissionPoint[]
).map((code) => ({
  code,
  name: PERMISSION_DISPLAY_NAMES[code],
  module: permissionModule(code),
  description: null,
}));

/**
 * 权限点目录（管理端角色权限矩阵用）。
 *
 * HTTP 模式读 `GET /permissions`：中文名与模块都是服务端给的；
 * mock 模式用前端的权限词表（`PERMISSION_DISPLAY_NAMES`）。
 */
export function usePermissionCatalog(): AdminPermission[] {
  const remote = isBackendEnabled();
  const [permissions, setPermissions] = useState<AdminPermission[]>([]);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void (async () => {
      const list = await loadPermissions().catch(() => []);
      if (!cancelled) setPermissions(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [remote]);

  return useMemo(
    () => (remote ? permissions : MOCK_PERMISSION_CATALOG),
    [remote, permissions],
  );
}

/**
 * 新建自定义角色。
 *
 * 编码全局唯一：重复会被后端判为 422「角色编码「x」已存在。」。
 */
export async function createRoleSettings(input: {
  code: string;
  name: string;
  description: string;
  permissionCodes: string[];
}): Promise<{ ok: boolean; message?: string }> {
  if (!isBackendEnabled()) {
    const result = createRole(input);
    return result.ok ? { ok: true } : { ok: false, message: result.message ?? "创建失败" };
  }

  try {
    await createRoleApi(input);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error && error.message ? error.message : "创建失败",
    };
  }
}

/**
 * 改角色的名称、说明与权限集合。
 *
 * 权限集合是**整体覆盖**：少传一个权限点，那个权限点就没了。
 */
export async function saveRoleSettings(
  role: AdminRole,
  input: { name: string; description: string; permissionCodes: string[] },
): Promise<{ ok: boolean; message?: string }> {
  if (!isBackendEnabled()) {
    const result = setRolePermissions(role.code, input.permissionCodes);
    return result.ok ? { ok: true } : { ok: false, message: result.message ?? "保存失败" };
  }

  try {
    await updateRole(role.id, input);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error && error.message ? error.message : "保存失败",
    };
  }
}

/* ------------------------------------------------------------ 组织标签 */

/**
 * 组织维度标签（院系 / 专业 / 班级）。
 *
 * HTTP 模式读 `GET /tags` 的 organization 分组——它由名单导入自动创建，
 * 没有导入过就是空的。
 */
export function useAdminOrgTags(): OrgTag[] {
  const remote = isBackendEnabled();
  const mockTags = useAdminOps((state) => state.orgTags);
  const [tags, setTags] = useState<OrgTag[]>([]);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await loadOrgTags();
        if (!cancelled) setTags(list);
      } catch {
        if (!cancelled) setTags([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote]);

  return useMemo(
    () => (remote ? tags : mockTags.map((tag) => ({ ...tag, code: tag.id }))),
    [remote, tags, mockTags],
  );
}

/* ------------------------------------------------------------ 用户清单 */

/**
 * 用户清单。
 *
 * 关键词与角色过滤交给服务端（mock 模式在前端过滤）：
 * 用户可能成千上万，前端不该全拉回来自己筛。
 *
 * @param filter 关键词与角色 ID（角色 ID 来自 `useAdminRoles`）。
 */
export function useAdminUserList(filter: {
  keyword: string;
  roleId: string;
  /** 角色码 → 角色中文名；由页面传入，避免再拉一次角色目录。 */
  roleNames: Record<string, string>;
  /** 组织维度标签目录；由页面传入，避免再拉一次标签。 */
  orgTags: OrgTag[];
}): {
  rows: AdminUserRow[];
  total: number;
  loading: boolean;
  refresh: () => void;
} {
  const remote = isBackendEnabled();
  const mockUsers = useAdminOps((state) => state.users);
  const mockTags = useAdminOps((state) => state.orgTags);

  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  // 组织标签名来自标签目录：列表接口只给标签 ID。
  const orgTagName = useCallback(
    (id: string) => filter.orgTags.find((tag) => tag.id === id)?.name ?? id,
    [filter.orgTags],
  );

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const page = await loadUserPage({
          keyword: filter.keyword.trim() || undefined,
          roleId: filter.roleId || undefined,
        });
        if (cancelled) return;
        setRows(
          page.items.map((user) => ({
            id: user.id,
            account: user.username,
            name: user.displayName,
            email: user.email,
            status: user.status,
            mustChangePassword: user.mustChangePassword,
            roles: user.roles,
            roleLabels: user.roles.map((code) => filter.roleNames[code] ?? code),
            orgTags: user.organizationTagIds.map((id) => ({
              id,
              name: orgTagName(id),
            })),
            orgPath: user.organizationPath,
            lastLoginAt: user.lastLoginAt,
          })),
        );
        setTotal(page.total);
      } catch {
        if (!cancelled) {
          setRows([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, filter.keyword, filter.roleId, filter.roleNames, orgTagName, token]);

  const mockRows = useMemo<AdminUserRow[]>(() => {
    if (remote) return [];
    const keyword = filter.keyword.trim().toLowerCase();
    return mockUsers
      .filter((user) => {
        // mock 的角色码就是角色名，过滤直接比字符串。
        if (filter.roleId && !user.roles.includes(filter.roleId as UserRole)) return false;
        if (keyword && !`${user.account} ${user.name} ${user.email}`.toLowerCase().includes(keyword)) {
          return false;
        }
        return true;
      })
      .map((user) => ({
        id: user.id,
        account: user.account,
        name: user.name,
        email: user.email,
        status: user.status,
        mustChangePassword: Boolean(user.mustChangePassword),
        roles: [...user.roles],
        roleLabels: user.roles.map((code) => filter.roleNames[code] ?? USER_ROLE_LABEL[code] ?? code),
        orgTags: user.orgTags.map((id) => ({
          id,
          name: mockTags.find((tag) => tag.id === id)?.name ?? id,
        })),
        orgPath: "",
        lastLoginAt: user.lastLoginAt,
      }));
  }, [remote, mockUsers, mockTags, filter.keyword, filter.roleId, filter.roleNames]);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  return {
    rows: remote ? rows : mockRows,
    total: remote ? total : mockRows.length,
    loading,
    refresh,
  };
}

/* ------------------------------------------------------------ 用户动作 */

/**
 * 用户变更动作。
 *
 * 每次变更后由调用方刷新列表——状态、角色、组织归属都要重新拉。
 */
export function useAdminUserActions(options: {
  /** 角色码 → 角色 ID（HTTP 模式要的是 ID）。 */
  roleIdOf: (code: string) => string;
  /** 变更后刷新列表。 */
  refresh: () => void;
  /** 写审计日志（mock 模式；HTTP 模式由后端记录）。 */
  audit?: (userId: string, summary: string, action: AuditAction) => void;
}): {
  setRoles: (userId: string, roleCodes: string[]) => Promise<void>;
  setStatus: (user: AdminUserRow, status: AdminUserStatus) => Promise<void>;
  setOrgTags: (userId: string, tagIds: string[]) => Promise<void>;
} {
  const remote = isBackendEnabled();

  const setRoles = useCallback(
    async (userId: string, roleCodes: string[]) => {
      if (roleCodes.length === 0) throw new Error("至少保留一个角色");
      if (!remote) {
        const result = setUserRoles(userId, roleCodes as UserRole[]);
        if (!result.ok) throw new Error(result.message ?? "角色变更失败");
        options.audit?.(
          userId,
          `调整用户角色为：${roleCodes.map((c) => USER_ROLE_LABEL[c as UserRole] ?? c).join("、")}`,
          "user.assign-roles",
        );
        options.refresh();
        return;
      }
      await assignUserRoles(userId, roleCodes.map((code) => options.roleIdOf(code)));
      options.refresh();
    },
    [remote, options],
  );

  const setStatus = useCallback(
    async (user: AdminUserRow, status: AdminUserStatus) => {
      if (!remote) {
        const result = updateUser(user.id, { status: status as "active" | "disabled" });
        if (!result.ok) throw new Error(result.message ?? "状态更新失败");
        options.audit?.(
          user.id,
          `将用户置为${status === "active" ? "正常" : "已停用"}`,
          "user.update",
        );
        options.refresh();
        return;
      }
      // 档案接口是整份覆盖：姓名、邮箱、电话要原样带回，不能发空值。
      await updateAdminUser(user.id, {
        displayName: user.name,
        email: user.email,
        phone: "",
        status,
      });
      options.refresh();
    },
    [remote, options],
  );

  const setOrgTags = useCallback(
    async (userId: string, tagIds: string[]) => {
      if (!remote) {
        const result = updateUser(userId, { orgTags: tagIds });
        if (!result.ok) throw new Error(result.message ?? "组织标签更新失败");
        options.audit?.(userId, "调整用户的组织归属标签", "user.assign-tags");
        options.refresh();
        return;
      }
      await assignUserTags(userId, tagIds);
      options.refresh();
    },
    [remote, options],
  );

  return { setRoles, setStatus, setOrgTags };
}

/* ------------------------------------------------------------ 名单导入 */

/**
 * 执行名单导入。
 *
 * HTTP 模式把**原文件**交给服务端：逐行校验、失败行跳过、组织标签自动创建
 * 全在后端做，前端的预览只是给人看的。
 */
export async function importRosterFile(
  file: File | null,
  previewRows: RosterPreviewRow[],
): Promise<RosterImportResult> {
  if (!isBackendEnabled()) {
    return importRoster(previewRows);
  }
  if (!file) throw new Error("请先选择名单文件");

  const result = await importUserRoster(file);
  return {
    total: result.total,
    succeeded: result.succeeded,
    created: result.created,
    updated: result.updated,
    failed: result.failures.length,
    failures: result.failures.map((failure) => ({
      rowNo: failure.rowNumber,
      account: failure.username,
      reason: failure.reason,
    })),
    initialPasswords: result.generatedPasswords.map((item) => ({
      account: item.username,
      password: item.password,
    })),
  };
}

/** mock 模式的审计写入（HTTP 模式由后端记录）。 */
export function writeUserAudit(userId: string, summary: string, action: AuditAction): void {
  writeAudit({
    operator: "陈砚之",
    action,
    targetType: "user",
    targetId: userId,
    summary,
    ip: "10.12.0.21",
    userAgent: "Chrome 131 / Windows",
  });
}
