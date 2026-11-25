/* ==========================================================================
   知行测评 · 登录态
   --------------------------------------------------------------------------
   两种运行模式（与数据源开关同一判定，见 `api/dataSource.ts`）：

   - **mock**（缺省）：用应用提供的演示身份自动登录，路由守卫与权限判定
     照常生效，演示不被「必须先登录」挡住。
   - **http**：走 `POST /auth/login` / `GET /auth/me` / `POST /auth/logout`。
     令牌只存内存（tokenStore）；刷新页面时用 HttpOnly Cookie 静默换发：
     先 `POST /auth/refresh`，再 `GET /auth/me`。

   权限以**服务端返回的权限码为准**（http 模式）；mock 模式退回本地角色矩阵，
   保证演示可用。后端仍会独立校验每个请求的权限。
   ========================================================================== */

import { create } from "zustand";
import type { UserRole } from "../domain/types";
import { ENDPOINTS } from "../api/endpoints";
import { httpClient } from "../api/httpClient";
import { dataSourceMode } from "../api/dataSource";
import { refreshAccessToken } from "../api/authRefresh";
import { clearTokens, getAccessToken, setTokens } from "../api/tokenStore";
import { permissionsFor, type PermissionPoint } from "./permissions";
import { writeAudit } from "../mock/adminOps";
import { describePasswordViolations, passwordPolicyViolations } from "../domain/password";

/**
 * mock 模式审计行的来源信息。沿用其它示例审计的同一套取值：
 * mock 的 IP / UA 是演示数据，与 http 模式的真实来源本来就不同。
 */
const MOCK_AUDIT_IP = "10.12.0.21";
const MOCK_AUDIT_UA = "Chrome 131 / Windows";

/** 登录用户档案（前端口径）。 */
export interface AuthUser {
  /** 用户 ID（后端为主键，前端按字符串处理）。 */
  id: string;
  /** 登录账号。 */
  account: string;
  /** 姓名。 */
  name: string;
  /** 角色列表。 */
  roles: UserRole[];
  /** 组织维度标签 ID 列表；社会人士为空。 */
  orgTags: string[];
  /** 服务端下发的权限码；mock 模式没有，退回角色矩阵。 */
  permissions?: PermissionPoint[];
  /** 是否必须先改密码（管理员重置密码或导入名单后置位）。 */
  mustChangePassword?: boolean;
}

/** 运行模式。 */
export type AuthMode = "mock" | "http";

/** 后端 /auth/me 与 /auth/login 返回的用户档案（UserProfileDto）。 */
interface ApiUser {
  id?: string | number;
  username?: string;
  displayName?: string;
  roles?: UserRole[];
  permissions?: string[];
  organizationTags?: Array<{ id?: string | number; name?: string }>;
  mustChangePassword?: boolean;
}

/** 当前是否走真实后端。 */
export function authMode(): AuthMode {
  return dataSourceMode();
}

/** 登录态状态。 */
export interface AuthState {
  /** 认证状态。 */
  status: "unknown" | "authenticated" | "anonymous";
  /** 当前用户。 */
  user: AuthUser | null;
  /** 运行模式。 */
  mode: AuthMode;
  /** 初始化：mock 模式用演示身份登录；http 模式先静默刷新再拉 /auth/me。 */
  bootstrap: (demo?: AuthUser | null) => Promise<void>;
  /** 登录。 */
  signIn: (
    account: string,
    password: string,
    demo?: AuthUser | null,
  ) => Promise<{ ok: boolean; message?: string }>;
  /** 登出。 */
  signOut: () => void;
  /** 修改本人密码。 */
  changePassword: (current: string, next: string) => Promise<{ ok: boolean; message?: string }>;
  /**
   * 管理员重置他人密码。
   * <para>
   * 置为**系统设定的原始密码**（在「系统设置」里配好的那个），
   * 不由这里传密码——响应里也不带密码。后端一律置「必须改密」：
   * 重置出来的密码只作首次登录凭据。
   * </para>
   */
  resetPassword: (userId: string) => Promise<{ ok: boolean; message?: string }>;
  /** 是否拥有权限点。 */
  can: (point: PermissionPoint) => boolean;
  /** 当前用户的权限点并集。 */
  permissions: () => PermissionPoint[];
}

function toAuthUser(user: ApiUser | undefined, fallbackAccount = ""): AuthUser | null {
  if (!user) return null;
  const account = user.username ?? fallbackAccount;
  const profile: AuthUser = {
    id: String(user.id ?? account),
    account,
    name: user.displayName ?? account,
    roles: user.roles ?? [],
    orgTags: (user.organizationTags ?? []).map((tag) => String(tag.id ?? "")),
    mustChangePassword: user.mustChangePassword ?? false,
  };
  if (Array.isArray(user.permissions)) {
    profile.permissions = user.permissions as PermissionPoint[];
  }
  return profile;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: "unknown",
  user: null,
  mode: authMode(),

  bootstrap: async (demo) => {
    if (get().mode === "http") {
      try {
        // 页面刷新后 access token 已丢：先用 HttpOnly Cookie 静默换发。
        // 没有有效 Cookie 时 refresh 返回 null，随后的 /auth/me 会 401。
        if (!getAccessToken()) await refreshAccessToken();
        const profile = await httpClient.get<ApiUser>(ENDPOINTS.auth.me);
        const user = toAuthUser(profile);
        set({ status: user ? "authenticated" : "anonymous", user });
      } catch {
        set({ status: "anonymous", user: null });
      }
      return;
    }
    // mock 模式：演示身份直接登录，保证守卫与权限判定照常跑通。
    if (demo) {
      set({ status: "authenticated", user: demo });
      return;
    }
    set({ status: "anonymous", user: null });
  },

  signIn: async (account, password, demo) => {
    if (!account.trim() || !password) {
      return { ok: false, message: "请输入账号与密码" };
    }
    if (get().mode === "http") {
      try {
        const res = await httpClient.post<{
          accessToken: string;
          expiresIn?: number;
          user?: ApiUser;
        }>(ENDPOINTS.auth.login, { username: account.trim(), password });
        setTokens({
          accessToken: res.accessToken,
          ...(res.expiresIn ? { expiresAt: Date.now() + res.expiresIn * 1000 } : {}),
        });
        const user = toAuthUser(res.user, account.trim());
        set({ status: user ? "authenticated" : "anonymous", user });
        return user ? { ok: true } : { ok: false, message: "登录失败：未返回用户档案" };
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : "账号或密码错误";
        return { ok: false, message };
      }
    }
    // mock 模式：演示账号直接登录。
    if (demo) {
      set({ status: "authenticated", user: { ...demo, account: account.trim() } });
      // 登录也要留痕（FR-AUD-01）：http 模式由后端写，mock 模式在这里补同一行。
      writeAudit({
        operator: demo.name,
        action: "auth.login",
        targetType: "user",
        targetId: demo.id,
        summary: "登录成功",
        ip: MOCK_AUDIT_IP,
        userAgent: MOCK_AUDIT_UA,
      });
      return { ok: true };
    }
    // 登不进去的账号也留痕：只知道自称的账号，不知道是谁。
    writeAudit({
      operator: account.trim(),
      action: "auth.login_failed",
      targetType: "user",
      targetId: account.trim(),
      summary: "密码错误",
      ip: MOCK_AUDIT_IP,
      userAgent: MOCK_AUDIT_UA,
    });
    return { ok: false, message: "账号或密码错误" };
  },

  signOut: () => {
    // 先通知服务端吊销刷新令牌族（HttpOnly Cookie 只能由服务端清除）。
    if (get().mode === "http") {
      void httpClient.post(ENDPOINTS.auth.logout).catch(() => undefined);
    } else {
      // mock 模式：登出也要留痕（http 模式由后端写）。
      const user = get().user;
      writeAudit({
        operator: user?.name ?? "",
        action: "auth.logout",
        targetType: "user",
        targetId: user?.id ?? "",
        summary: "登出",
        ip: MOCK_AUDIT_IP,
        userAgent: MOCK_AUDIT_UA,
      });
    }
    clearTokens();
    set({ status: "anonymous", user: null });
  },

  changePassword: async (current, next) => {
    if (!current || !next) return { ok: false, message: "请填写原密码与新密码" };
    if (current === next) return { ok: false, message: "新密码不能与原密码相同" };
    const violations = passwordPolicyViolations(next, get().user?.account ?? "");
    if (violations.length > 0) {
      return {
        ok: false,
        message: describePasswordViolations(violations, "新密码"),
      };
    }
    if (get().mode === "http") {
      try {
        const res = await httpClient.post<{
          accessToken?: string;
          expiresIn?: number;
        }>(ENDPOINTS.auth.changePassword, {
          currentPassword: current,
          newPassword: next,
        });

        // 改密前的令牌带着「必须改密」标记：换掉它才能继续用系统。
        if (res?.accessToken) {
          setTokens({
            accessToken: res.accessToken,
            ...(res.expiresIn ? { expiresAt: Date.now() + res.expiresIn * 1000 } : {}),
          });
        }
        const user = get().user;
        if (user) {
          set({ user: { ...user, mustChangePassword: false } });
        }
        return { ok: true };
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : "修改失败，请重试";
        return { ok: false, message };
      }
    }
    // mock 模式：校验规则照走，接口调用省略。
    return { ok: true };
  },

  resetPassword: async (userId) => {
    if (!userId) return { ok: false, message: "用户不存在" };
    if (get().mode === "http") {
      try {
        // 密码由后端取系统设定的原始密码，请求里不带密码。
        await httpClient.post(ENDPOINTS.admin.resetPassword(userId));
        return { ok: true };
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : "重置失败，请重试";
        return { ok: false, message };
      }
    }
    return { ok: true };
  },

  can: (point) => get().permissions().includes(point),

  permissions: () => {
    const user = get().user;
    if (user?.permissions && user.permissions.length > 0) return user.permissions;
    return permissionsFor(user?.roles);
  },
}));

/** 便捷读取：当前用户是否拥有某权限点。 */
export function useCan(point: PermissionPoint): boolean {
  return useAuth((state) => state.permissions().includes(point));
}

/** 便捷读取：当前用户是否必须先改密码。 */
export function useMustChangePassword(): boolean {
  return useAuth((state) => state.user?.mustChangePassword === true);
}
