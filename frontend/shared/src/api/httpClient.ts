/* ==========================================================================
   知行测评 · HTTP 客户端
   --------------------------------------------------------------------------
   职责：基地址拼接、超时控制、错误归一化、认证头注入、401 单飞刷新重试。

   基地址取 `apiBaseUrl()`：同源部署是 `/api/v1`，跨域部署是
   `VITE_API_BASE_URL`。请求路径来自 `ENDPOINTS`（相对 API 根），
   两者拼起来才是完整地址，避免双前缀。
   ========================================================================== */

import {
  NETWORK_ERROR_MESSAGE,
  normalizeProblem,
  parseProblemDetails,
  type NormalizedProblem,
} from "./problemDetails";
import { apiBaseUrl } from "./dataSource";
import { refreshAccessToken } from "./authRefresh";
import { ENDPOINTS } from "./endpoints";
import { getAccessToken, type TokenPair } from "./tokenStore";

/** 请求方法。 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** 请求配置。 */
export interface RequestOptions {
  method?: HttpMethod;
  /** 请求体；对象会自动 JSON 序列化。 */
  body?: unknown;
  /** 额外请求头。 */
  headers?: Record<string, string>;
  /** 超时毫秒数，默认 15s。 */
  timeoutMs?: number;
  /** 是否携带 access token，默认 true。 */
  auth?: boolean;
  /** 取消信号。 */
  signal?: AbortSignal;
  /** 查询参数。 */
  query?: Record<string, string | number | boolean | undefined | null>;
}

/** 归一化后的请求错误。 */
export class HttpError extends Error {
  readonly problem: NormalizedProblem;
  readonly status: number | undefined;

  constructor(problem: NormalizedProblem) {
    super(problem.message);
    this.name = "HttpError";
    this.problem = problem;
    this.status = problem.status;
  }
}

/** 默认超时。 */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 默认基地址。
 *
 * 保留该导出是为了兼容既有引用；实际基地址由 `apiBaseUrl()` 决定，
 * 调用方一般不需要显式传 `baseUrl`。
 */
export const DEFAULT_BASE_URL = "";

/** HTTP 客户端配置。 */
export interface HttpClientConfig {
  /** API 根地址；缺省取 `apiBaseUrl()`。 */
  baseUrl?: string;
  timeoutMs?: number;
  /** 注入认证头，默认读取 tokenStore 的 access token。 */
  getAuthToken?: () => string | null;
  /** 全局请求头。 */
  headers?: Record<string, string>;
  /**
   * 收到 401 时的刷新函数；返回 null 表示刷新失败。
   * 未配置时不自动刷新。
   */
  refreshToken?: () => Promise<TokenPair | null>;
}

function buildUrl(baseUrl: string, path: string, query: RequestOptions["query"]): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const qs = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      qs.set(key, String(value));
    }
  }
  const search = qs.toString();
  return `${base}${suffix}${search ? `?${search}` : ""}`;
}

/**
 * 创建一个带超时、错误归一化与 401 刷新重试的 fetch 客户端。
 */
export function createHttpClient(config: HttpClientConfig = {}) {
  const baseUrl = config.baseUrl ?? apiBaseUrl();
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const getAuthToken = config.getAuthToken ?? getAccessToken;

  // 单飞：并发 401 只触发一次刷新。
  let refreshInFlight: Promise<TokenPair | null> | null = null;

  function runRefresh(): Promise<TokenPair | null> {
    const refresh = config.refreshToken;
    if (!refresh) return Promise.resolve(null);

    if (!refreshInFlight) {
      refreshInFlight = refresh()
        .catch(() => null)
        .finally(() => {
          refreshInFlight = null;
        });
    }

    return refreshInFlight;
  }

  function shouldRefresh(path: string): boolean {
    return (
      config.refreshToken !== undefined &&
      path !== ENDPOINTS.auth.login &&
      path !== ENDPOINTS.auth.refresh &&
      path !== ENDPOINTS.auth.logout
    );
  }

  async function dispatch(path: string, options: RequestOptions): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? timeoutMs);
    const externalSignal = options.signal;
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onExternalAbort);

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...config.headers,
      ...options.headers,
    };
    // FormData 由浏览器自己带 multipart boundary，不能手动设 Content-Type。
    const isFormData =
      typeof FormData !== "undefined" && options.body instanceof FormData;
    if (options.body !== undefined && headers["Content-Type"] === undefined && !isFormData) {
      headers["Content-Type"] = "application/json";
    }
    if (options.auth !== false) {
      const token = getAuthToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    try {
      const init: RequestInit = {
        method: options.method ?? "GET",
        headers,
        signal: controller.signal,
        // 刷新令牌在 HttpOnly Cookie 里，跨域部署必须显式允许带 Cookie。
        credentials: "include",
      };
      if (options.body !== undefined) {
        if (typeof options.body === "string") init.body = options.body;
        else if (isFormData) init.body = options.body as BodyInit;
        else init.body = JSON.stringify(options.body);
      }
      return await fetch(buildUrl(baseUrl, path, options.query), init);
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new HttpError({
        message: aborted ? "请求超时，请稍后重试" : NETWORK_ERROR_MESSAGE,
      });
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    let response = await dispatch(path, options);

    // access token 过期：刷新一次后重放原请求。
    if (response.status === 401 && options.auth !== false && shouldRefresh(path)) {
      const tokens = await runRefresh();
      if (tokens) {
        response = await dispatch(path, options);
      }
    }

    if (!response.ok) {
      const problem = await parseProblemDetails(response);
      throw new HttpError(normalizeProblem(problem));
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  return {
    get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
      request<T>(path, { ...options, method: "GET" }),
    post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
      request<T>(path, { ...options, method: "POST", body }),
    put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
      request<T>(path, { ...options, method: "PUT", body }),
    patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
      request<T>(path, { ...options, method: "PATCH", body }),
    delete: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
      request<T>(path, { ...options, method: "DELETE" }),
  };
}

/** 默认客户端实例：带上 Cookie 刷新能力。 */
export const httpClient = createHttpClient({ refreshToken: refreshAccessToken });
