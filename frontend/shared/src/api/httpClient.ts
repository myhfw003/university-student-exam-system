/* ==========================================================================
   知行测评 · HTTP 客户端骨架
   --------------------------------------------------------------------------
   职责：超时控制、错误归一化、认证头注入。
   本文件只提供骨架与类型，**不实现任何真实请求**（真实调用待后端接口就绪后接入）。
   ========================================================================== */

import {
  NETWORK_ERROR_MESSAGE,
  normalizeProblem,
  parseProblemDetails,
  type NormalizedProblem,
} from "./problemDetails";
import { getAccessToken } from "./tokenStore";

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

/** 默认基地址（骨架占位，接入后端时由各应用通过 createHttpClient 覆盖）。 */
export const DEFAULT_BASE_URL = "/api/v1";

/** HTTP 客户端配置。 */
export interface HttpClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
  /** 注入认证头，默认读取 tokenStore 的 access token。 */
  getAuthToken?: () => string | null;
  /** 全局请求头。 */
  headers?: Record<string, string>;
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
 * 创建一个带超时与错误归一化的 fetch 客户端。
 * 骨架阶段不内置任何业务端点。
 */
export function createHttpClient(config: HttpClientConfig = {}) {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const getAuthToken = config.getAuthToken ?? getAccessToken;

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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
    if (options.body !== undefined && headers["Content-Type"] === undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (options.auth !== false) {
      const token = getAuthToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      const init: RequestInit = {
        method: options.method ?? "GET",
        headers,
        signal: controller.signal,
      };
      if (options.body !== undefined) {
        init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      }
      response = await fetch(buildUrl(baseUrl, path, options.query), init);
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new HttpError({
        message: aborted ? "请求超时，请稍后重试" : NETWORK_ERROR_MESSAGE,
      });
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
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

/** 默认客户端实例（骨架）。 */
export const httpClient = createHttpClient();
