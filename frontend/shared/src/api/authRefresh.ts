/* ==========================================================================
   知行测评 · 刷新令牌
   --------------------------------------------------------------------------
   刷新令牌存在 HttpOnly Cookie（`rt`，路径 `/api/v1/auth`）里，JS 读不到，
   因此刷新只能靠浏览器自动带上 Cookie 发 `POST /auth/refresh`。

   这里用原生 fetch 而不是 httpClient：httpClient 的 401 重试本身就要调用
   本函数，走 httpClient 会形成递归。

   **必须单飞**：刷新令牌是一次性的（用掉即失效）。同一个 Cookie 并发刷新
   两次时，后一次会被判成「盗用」并**整族吊销**——连前一次刚换发的新令牌
   一起废掉，会话当场死掉，页面回到登录页。
   而并发刷新很容易发生：页面加载时「引导登录态的刷新」与「某个请求 401
   触发的刷新」会同时发出。
   ========================================================================== */

import { apiBaseUrl } from "./dataSource";
import { ENDPOINTS } from "./endpoints";
import { setTokens, type TokenPair } from "./tokenStore";

interface RefreshBody {
  accessToken?: string;
  expiresIn?: number;
}

/** 正在进行的刷新。并发调用共用同一个请求，绝不并发出两次。 */
let inFlight: Promise<TokenPair | null> | null = null;

/**
 * 用 HttpOnly Cookie 换发访问令牌。
 *
 * 并发调用共用一次请求（单飞）：刷新令牌用掉即失效，
 * 并发刷新会被后端判成盗用并整族吊销。
 *
 * @returns 新的令牌对；没有有效 Cookie 或网络失败时返回 null。
 */
export function refreshAccessToken(): Promise<TokenPair | null> {
  if (!inFlight) {
    inFlight = requestNewToken().finally(() => {
      inFlight = null;
    });
  }

  return inFlight;
}

/** 真正发一次刷新请求。 */
async function requestNewToken(): Promise<TokenPair | null> {
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
