/* ==========================================================================
   知行测评 · 认证拦截器骨架
   --------------------------------------------------------------------------
   流程（docs/design/06-frontend.md §3.2）：
     401 → 单飞（single-flight）刷新 → 刷新成功后重放原请求
          → 刷新失败（401）→ 清除本地态 → 跳转登录页并携带原路由

   刷新请求单飞：并发 401 只触发一次刷新，其余请求排队等待同一个 Promise。
   本文件只提供骨架与类型，不实现真实刷新请求。
   ========================================================================== */

import { HttpError } from "./httpClient";
import { clearTokens, getAccessToken, setTokens, type TokenPair } from "./tokenStore";

/** 刷新令牌函数：由各应用注入真实实现（如 POST /auth/refresh，读 HttpOnly Cookie）。 */
export type RefreshTokenFn = () => Promise<TokenPair | null>;

/** 刷新失败时的回调：用于清空本地态并跳转登录页。 */
export type OnAuthFailureFn = (error: unknown) => void;

/** 拦截器配置。 */
export interface AuthInterceptorConfig {
  /** 刷新令牌函数。 */
  refreshToken: RefreshTokenFn;
  /** 刷新失败回调。 */
  onAuthFailure?: OnAuthFailureFn;
}

let inFlightRefresh: Promise<TokenPair | null> | null = null;

/**
 * 单飞刷新：并发调用共享同一个 Promise。
 */
export function refreshOnce(refreshToken: RefreshTokenFn): Promise<TokenPair | null> {
  if (!inFlightRefresh) {
    inFlightRefresh = refreshToken()
      .then((tokens) => {
        if (tokens) setTokens(tokens);
        return tokens;
      })
      .finally(() => {
        inFlightRefresh = null;
      });
  }
  return inFlightRefresh;
}

/** 是否存在进行中的刷新。 */
export function isRefreshing(): boolean {
  return inFlightRefresh !== null;
}

/**
 * 判断错误是否为 401。
 */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof HttpError && error.status === 401;
}

/**
 * 包装一个「会发起请求」的操作：遇到 401 时刷新令牌并重放一次。
 *
 * @param operation 实际发请求的操作，接收当前 access token
 * @param config    拦截器配置
 */
export async function withAuthRetry<T>(
  operation: (accessToken: string | null) => Promise<T>,
  config: AuthInterceptorConfig,
): Promise<T> {
  try {
    return await operation(getAccessToken());
  } catch (error) {
    if (!isUnauthorized(error)) throw error;

    const tokens = await refreshOnce(config.refreshToken);
    if (!tokens) {
      clearTokens();
      config.onAuthFailure?.(error);
      throw error;
    }

    try {
      return await operation(getAccessToken());
    } catch (retryError) {
      if (isUnauthorized(retryError)) {
        clearTokens();
        config.onAuthFailure?.(retryError);
      }
      throw retryError;
    }
  }
}
