/* ==========================================================================
   知行测评 · AI 生成试题
   --------------------------------------------------------------------------
   两步：

   1. `GET /ai/providers` —— 服务端有哪些供应商与模型可切。
      没配 API Key 的供应商也会列出来（`configured: false`），
      界面上据此提示「服务端未配置」，而不是装作没有这个功能。
   2. `POST /ai/generations` —— 按选定的模型生成。

   生成的题落在**服务端的候选题队列**（草稿），前端只发起请求、显示结果：
   通不过校验的题由服务端逐条说明原因，不落库。
   ========================================================================== */

import { ENDPOINTS } from "./endpoints";
import { HttpError, httpClient } from "./httpClient";
import { normalizeProblem } from "./problemDetails";
import { apiBaseUrl } from "./dataSource";
import { getAccessToken } from "./tokenStore";

/** AI 接口所需的客户端。 */
export type AiClient = Pick<typeof httpClient, "get" | "post">;

/**
 * AI 生成的请求超时。
 *
 * <para>
 * 默认的 15s 是给普通接口用的，**模型调用远不止**：实测 8 道题
 * MiniMax-M3.1-Flash 要 7 秒、M3 要 49 秒。沿用默认超时的话，
 * 界面每次都只会报「请求超时，请稍后重试」，而服务端其实已经把题出好了。
 * </para>
 *
 * <para>比服务端的超时（300 秒）留一点余量：宁可让服务端自己的错误
 * （502 / 27102）先到，也不要被浏览器先掐断。</para>
 */
export const AI_GENERATION_TIMEOUT_MS = 330_000;

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

/**
 * 校验失败时字段名 → 中文说明。
 * <para>
 * 服务端回的是字段名（前后端共用的契约），直接甩给老师看是英文的，
 * 等于没提示。这里翻成中文。
 * </para>
 */
const AI_FIELD_LABELS: Record<string, string> = {
  Provider: "AI 供应商",
  Model: "模型",
  Count: "生成数量",
  Type: "题型",
  DifficultyTagId: "难度",
  TagIds: "知识点标签",
  Prompt: "出题要求",
};

/**
 * 把字段级校验错误拼成一句人话。
 * <p>
 * 只说「请求参数校验失败」，用户不知道是哪儿错了——出题要求写太长？
 * 标签选多了？都看不出来。
 * </p>
 */
export function describeValidationErrors(
  errors: Record<string, string[]> | undefined,
): string | undefined {
  if (!errors) return undefined;

  const parts = Object.entries(errors)
    .map(([field, messages]) => {
      const label = AI_FIELD_LABELS[field] ?? field;
      return `${label}：${messages.join("、")}`;
    })
    .filter((part) => part.length > 0);

  return parts.length > 0 ? parts.join("；") : undefined;
}

/** 可用的供应商。 */
export interface AiProvider {
  /** 供应商标识（服务端配置里的名字）。 */
  name: string;
  /** 中文名，界面上显示。 */
  displayName: string;
  /** 服务端是否已配置 API Key。 */
  configured: boolean;
  /** 默认模型。 */
  defaultModel: string;
  /** 可切换的模型清单。 */
  models: string[];
}

/** 生成结果里的一道题。 */
export interface AiGenerationItem {
  /** 第几道（从 1 开始）。 */
  index: number;
  /** 是否已落库成候选题。 */
  succeeded: boolean;
  /** 落库的题目 ID（成功时）。 */
  questionId: string | null;
  /** 题号（成功时）。 */
  code: string | null;
  /** 题干（成功时）。 */
  stem: string | null;
  /** 失败原因（失败时）。 */
  errors: string[];
}

/** 一次生成的整体结果。 */
export interface AiGenerationResult {
  provider: string;
  providerName: string;
  model: string;
  /** 请求生成几道。 */
  requested: number;
  /** 成功落库几道。 */
  succeeded: number;
  /** 通不过校验几道。 */
  failed: number;
  items: AiGenerationItem[];
}

/** 供应商 DTO → 前端口径。 */
export function toAiProvider(dto: Dto): AiProvider {
  return {
    name: str(dto.name),
    displayName: str(dto.displayName, str(dto.name)),
    configured: dto.configured === true,
    defaultModel: str(dto.defaultModel),
    models: Array.isArray(dto.models) ? dto.models.map((m) => str(m)) : [],
  };
}

/** 生成结果 DTO → 前端口径。 */
export function toAiGenerationResult(dto: Dto): AiGenerationResult {
  const items = Array.isArray(dto.items) ? (dto.items as Dto[]) : [];

  return {
    provider: str(dto.provider),
    providerName: str(dto.providerName, str(dto.provider)),
    model: str(dto.model),
    requested: num(dto.requested),
    succeeded: num(dto.succeeded),
    failed: num(dto.failed),
    items: items.map((item) => ({
      index: num(item.index),
      succeeded: item.succeeded === true,
      questionId: item.questionId === null || item.questionId === undefined ? null : str(item.questionId),
      code: item.code ? str(item.code) : null,
      stem: item.stem ? str(item.stem) : null,
      errors: Array.isArray(item.errors) ? item.errors.map((e) => str(e)) : [],
    })),
  };
}

/** 读取可用的供应商与模型。 */
export async function loadAiProviders(client: AiClient = httpClient): Promise<AiProvider[]> {
  const res = await client.get<{ providers?: Dto[] }>(ENDPOINTS.ai.providers);
  return (res.providers ?? []).map(toAiProvider);
}

/** 生成试题。 */
export async function generateAiQuestions(
  input: {
    provider: string;
    model: string;
    count: number;
    type: string;
    difficultyTagId: string;
    tagIds: string[];
    prompt: string;
  },
  client: AiClient = httpClient,
): Promise<AiGenerationResult> {
  const res = await client.post<Dto>(
    ENDPOINTS.ai.generations,
    {
      provider: input.provider,
      model: input.model,
      count: input.count,
      type: input.type,
      // 标签主键是数字：前端内部一律用字符串 ID，发出前转成数字
      // （与题目接口同一口径；发字符串服务端绑定不上，会直接 400）。
      difficultyTagId: Number(input.difficultyTagId),
      tagIds: input.tagIds.map(Number),
      prompt: input.prompt,
    },
    // 模型调用要几十秒，不能用默认的 15 秒超时。
    { timeoutMs: AI_GENERATION_TIMEOUT_MS },
  );

  return toAiGenerationResult(res);
}

/** 出题要求最长多少字（与服务端同一份限制）。 */
export const AI_PROMPT_MAX_LENGTH = 2000;

/** 知识点标签最多选几个（与服务端同一份限制）。 */
export const AI_MAX_TAGS = 5;

/* --------------------------------------------------------------- 流式生成 */

/**
 * 流式生成里的一道题。
 * <para>
 * 一道题**落库后**就推一条，所以界面上题目是一道道出现的，
 * 不是等整批出完才一起亮出来。
 * </para>
 */
export interface AiGenerationStreamItem {
  /** 第几道（从 1 开始）。 */
  index: number;
  /** 是否已落库成候选题。 */
  succeeded: boolean;
  /** 题目主键（成功时）。 */
  questionId: string | null;
  /** 题号（成功时）。 */
  code: string | null;
  /** 题型（存储值）。 */
  type: string | null;
  /** 题干。 */
  stem: string | null;
  /** 分值。 */
  score: number | null;
  /** 未通过校验的原因。 */
  errors: string[];
}

/** 整批结束的汇总。 */
export interface AiGenerationStreamSummary {
  requested: number;
  succeeded: number;
  failed: number;
  provider: string;
  providerName: string;
  model: string;
}

/** 流式生成里的错误。 */
export interface AiGenerationStreamError {
  /** 领域错误码（稳定契约）。 */
  errorCode: number;
  /** 面向用户的中文说明。 */
  message: string;
}

/** 流式生成的事件回调。 */
export interface AiGenerationStreamHandlers {
  /** 一道题落库了。 */
  onQuestion?: (item: AiGenerationStreamItem) => void;
  /** 一道题没过校验（没落库）。 */
  onFailed?: (item: AiGenerationStreamItem) => void;
  /** 整批结束。 */
  onDone?: (summary: AiGenerationStreamSummary) => void;
  /**
   * 出错了。
   * <para>
   * 流开始之后 HTTP 状态码已经发出去了，改不了，
   * 所以服务端把错误当作一条事件推过来——前端据此提示，
   * 而不是让老师看着像「生成完了但一道题都没有」。
   * </para>
   */
  onError?: (error: AiGenerationStreamError) => void;
}

/**
 * 空闲超时：一段时间没收到任何数据就判定为卡住。
 * <para>
 * 用**空闲**超时而不是总超时：整批可能要一分多钟，
 * 但只要还在吐字就不算卡住。
 * </para>
 */
export const AI_GENERATION_IDLE_TIMEOUT_MS = 120_000;

/**
 * 解析一段 SSE 文本（<c>event: xxx\ndata: {...}</c>）。
 * <para>导出出来是为了能单独测：流式解析最容易错在分隔与换行上。</para>
 */
export function parseSseBlock(raw: string): { event: string; data: string } | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith("event:")) {
      event = trimmed.slice("event:".length).trim();
    } else if (trimmed.startsWith("data:")) {
      dataLines.push(trimmed.slice("data:".length).replace(/^ /, ""));
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return { event, data: dataLines.join("\n") };
}

function toStreamItem(payload: unknown): AiGenerationStreamItem {
  const dto = (payload ?? {}) as Record<string, unknown>;
  const num = (value: unknown): number | null =>
    value === null || value === undefined || value === "" ? null : Number(value);

  return {
    index: Number(dto.index ?? 0),
    succeeded: dto.succeeded === true,
    questionId: dto.questionId === null || dto.questionId === undefined ? null : String(dto.questionId),
    code: dto.code ? String(dto.code) : null,
    type: dto.type ? String(dto.type) : null,
    stem: dto.stem ? String(dto.stem) : null,
    score: num(dto.score),
    errors: Array.isArray(dto.errors) ? dto.errors.map((e) => String(e)) : [],
  };
}

/**
 * 流式生成试题。
 * <para>
 * 走 SSE：服务器每落一道题就推一条事件，这边收到就回调——
 * 界面上的行是一道道长出来的。
 * </para>
 */
export async function generateAiQuestionsStream(
  input: {
    provider: string;
    model: string;
    count: number;
    type: string;
    difficultyTagId: string;
    tagIds: string[];
    prompt: string;
  },
  handlers: AiGenerationStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  signal?.addEventListener("abort", forwardAbort);

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdle = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), AI_GENERATION_IDLE_TIMEOUT_MS);
  };
  armIdle();

  try {
    const token = getAccessToken();
    const response = await fetch(`${apiBaseUrl()}${ENDPOINTS.ai.generationsStream}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        provider: input.provider,
        model: input.model,
        count: input.count,
        type: input.type,
        difficultyTagId: Number(input.difficultyTagId),
        tagIds: input.tagIds.map(Number),
        prompt: input.prompt,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const problem = await response.json().catch(() => null);
      const normalized = normalizeProblem(problem);
      const detail = describeValidationErrors(normalized.errors);
      throw new HttpError(detail ? { ...normalized, message: detail } : normalized);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      armIdle();
      buffer += decoder.decode(value, { stream: true });

      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        dispatchSseBlock(block, handlers);
        separator = buffer.indexOf("\n\n");
      }
    }
  } finally {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

function dispatchSseBlock(block: string, handlers: AiGenerationStreamHandlers): void {
  const parsed = parseSseBlock(block);
  if (!parsed) return;

  let payload: unknown;
  try {
    payload = JSON.parse(parsed.data);
  } catch {
    return;
  }

  if (parsed.event === "done") {
    handlers.onDone?.(payload as AiGenerationStreamSummary);
    return;
  }

  if (parsed.event === "error") {
    const dto = (payload ?? {}) as Record<string, unknown>;
    handlers.onError?.({
      errorCode: Number(dto.errorCode ?? 20500),
      message: typeof dto.message === "string" ? dto.message : "生成中断，请重试。",
    });
    return;
  }

  const item = toStreamItem(payload);
  if (parsed.event === "question") {
    handlers.onQuestion?.(item);
  } else if (parsed.event === "failed") {
    handlers.onFailed?.(item);
  }
}
