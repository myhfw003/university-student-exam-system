/* ==========================================================================
   知行测评 · 登录态
   --------------------------------------------------------------------------
   两种运行模式：

   - **mock**（默认，后端未就绪）：用应用提供的演示身份自动登录，
     路由守卫与权限判定照常生效，演示不被「必须先登录」挡住。
   - **http**（设置环境变量 `VITE_API_BASE_URL` 后启用）：
     走 `POST /auth/login` / `GET /auth/me` / `POST /auth/logout`，
     令牌只存内存（tokenStore），刷新页面靠 HttpOnly Cookie 静默换发。

   令牌**不落盘**：localStorage / sessionStorage 里不放令牌。
   ========================================================================== */

import { create } from "zustand";
import type { UserRole } from "../domain/types";
import { ENDPOINTS } from "../api/endpoints";
import { httpClient } from "../api/httpClient";
import { clearTokens, setTokens } from "../api/tokenStore";
import { hasPermission, permissionsFor, type PermissionPoint } from "./permissions";

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
}

/** 运行模式。 */
export type AuthMode = "mock" | "http";

/** 后端 /auth/me 与 /auth/login 返回的用户档案（按 05-api.md §2）。 */
interface ApiUser {
  id?: string | number;
  username?: string;
  displayName?: string;
  organizationTags?: Array<{ id?: string | number; name?: string }>;
  roles?: UserRole[];
}

/** 读取环境变量（共享层被两个 SPA 以源码方式消费，import.meta.env 需容错）。 */
function envValue(key: string): string | undefined {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.[key];
  } catch {
    return undefined;
  }
}

/** 当前是否走真实后端。 */
export function authMode(): AuthMode {
  return envValue("VITE_API_BASE_URL") ? "http" : "mock";
}

/** 登录态状态。 */
export interface AuthState {
  /** 认证状态。 */
  status: "unknown" | "authenticated" | "anonymous";
  /** 当前用户。 */
  user: AuthUser | null;
  /** 运行模式。 */
  mode: AuthMode;
  /** 初始化：mock 模式用演示身份登录；http 模式拉 /auth/me。 */
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
  /** 管理员重置他人密码。 */
  resetPassword: (
    userId: string,
    next: string,
    forceChange: boolean,
  ) => Promise<{ ok: boolean; message?: string }>;
  /** 是否拥有权限点。 */
  can: (point: PermissionPoint) => boolean;
  /** 当前用户的权限点并集。 */
  permissions: () => PermissionPoint[];
}

function toAuthUser(user: ApiUser | undefined, fallbackAccount = ""): AuthUser | null {
  if (!user) return null;
  const account = user.username ?? fallbackAccount;
  return {
    id: String(user.id ?? account),
    account,
    name: user.displayName ?? account,
    roles: user.roles ?? [],
    orgTags: (user.organizationTags ?? []).map((tag) => String(tag.id ?? "")),
  };
}

export const useAuth = create<AuthState>((set, get) => ({
  status: "unknown",
  user: null,
  mode: authMode(),

  bootstrap: async (demo) => {
    if (get().mode === "http") {
      try {
        const res = await httpClient.get<{ user: ApiUser }>(ENDPOINTS.auth.me);
        const user = toAuthUser(res?.user);
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
        const message =
          error instanceof Error && error.message ? error.message : "账号或密码错误";
        return { ok: false, message };
      }
    }
    // mock 模式：演示账号直接登录。
    if (demo) {
      set({ status: "authenticated", user: { ...demo, account: account.trim() } });
      return { ok: true };
    }
    return { ok: false, message: "账号或密码错误" };
  },

  signOut: () => {
    clearTokens();
    set({ status: "anonymous", user: null });
  },

  changePassword: async (current, next) => {
    if (!current || !next) return { ok: false, message: "请填写原密码与新密码" };
    if (current === next) return { ok: false, message: "新密码不能与原密码相同" };
    if (next.length < 8) return { ok: false, message: "新密码至少 8 位" };
    if (get().mode === "http") {
      try {
        await httpClient.post(ENDPOINTS.auth.changePassword, {
          currentPassword: current,
          newPassword: next,
        });
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

  resetPassword: async (userId, next, forceChange) => {
    if (!userId) return { ok: false, message: "用户不存在" };
    if (!next || next.length < 8) return { ok: false, message: "新密码至少 8 位" };
    if (get().mode === "http") {
      try {
        await httpClient.post(ENDPOINTS.admin.resetPassword(userId), {
          newPassword: next,
          mustChangeOnNextLogin: forceChange,
        });
        return { ok: true };
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : "重置失败，请重试";
        return { ok: false, message };
      }
    }
    return { ok: true };
  },

  can: (point) => hasPermission(get().user?.roles, point),

  permissions: () => permissionsFor(get().user?.roles),
}));

/** 便捷读取：当前用户是否拥有某权限点。 */
export function useCan(point: PermissionPoint): boolean {
  return useAuth((state) => hasPermission(state.user?.roles, point));
}
