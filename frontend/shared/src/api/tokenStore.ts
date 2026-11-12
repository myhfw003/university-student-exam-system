/* ==========================================================================
   知行测评 · 令牌存储
   --------------------------------------------------------------------------
   安全约束（docs/design/06-frontend.md §3.2）：
   access token 只存在于 JS 内存（模块级变量），**不写 localStorage、
   不写 sessionStorage**。刷新页面后由 /auth/refresh（HttpOnly Cookie）静默换发。
   ========================================================================== */

/** 内存中保存的令牌对。 */
export interface TokenPair {
  accessToken: string;
  /** 过期时间戳（毫秒，epoch）。 */
  expiresAt?: number;
  refreshToken?: string;
}

type Listener = (tokens: TokenPair | null) => void;

let current: TokenPair | null = null;
const listeners = new Set<Listener>();

/** 读取当前令牌对；未登录时返回 null。 */
export function getTokens(): TokenPair | null {
  return current;
}

/** 读取 access token；未登录时返回 null。 */
export function getAccessToken(): string | null {
  return current?.accessToken ?? null;
}

/** 写入令牌对并通知订阅者。 */
export function setTokens(tokens: TokenPair | null): void {
  current = tokens;
  for (const listener of listeners) {
    listener(current);
  }
}

/** 清除令牌（登出 / 刷新失败时调用）。 */
export function clearTokens(): void {
  setTokens(null);
}

/** 令牌是否已过期（含 60 秒提前量，用于主动刷新）。 */
export function isExpired(skewMs = 60_000, now = Date.now()): boolean {
  if (!current) return true;
  if (current.expiresAt === undefined) return false;
  return current.expiresAt - skewMs <= now;
}

/** 订阅令牌变化，返回取消订阅函数。 */
export function subscribeTokens(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
