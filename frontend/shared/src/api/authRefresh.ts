/* ==========================================================================
   知行测评 · 刷新令牌
   --------------------------------------------------------------------------
   刷新令牌存在 HttpOnly Cookie（`rt`，路径 `/api/v1/auth`）里，JS 读不到，
   因此刷新只能靠浏览器自动带上 Cookie 发 `POST /auth/refresh`。

   这里用原生 fetch 而不是 httpClient：httpClient 的 401 重试本身就要调用
   本函数，走 httpClient 会形成递归。
   ========================================================================== */

import { apiBaseUrl } from "./dataSource";
import { ENDPOINTS } from "./endpoints";
import { setTokens, type TokenPair } from "./tokenStore";

interface RefreshBody {
  accessToken?: string;
  expiresIn?: number;
}

/**
 * 用 HttpOnly Cookie 换发访问令牌。
 *
 * @returns 新的令牌对；没有有效 Cookie 或网络失败时返回 null。
 */
export async function refreshAccessToken(): Promise<TokenPair | null> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${ENDPOINTS.auth.refresh}`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  let body: RefreshBody;
  try {
    body = (await response.json()) as RefreshBody;
  } catch {
    return null;
  }

  if (!body.accessToken) return null;

  const tokens: TokenPair = { accessToken: body.accessToken };
  if (typeof body.expiresIn === "number") {
    tokens.expiresAt = Date.now() + body.expiresIn * 1000;
  }

  setTokens(tokens);
  return tokens;
}
