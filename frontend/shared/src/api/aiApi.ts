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
import { httpClient } from "./httpClient";

/** AI 接口所需的客户端。 */
export type AiClient = Pick<typeof httpClient, "get" | "post">;

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
  const res = await client.post<Dto>(ENDPOINTS.ai.generations, {
    provider: input.provider,
    model: input.model,
    count: input.count,
    type: input.type,
    // 标签主键是数字：前端内部一律用字符串 ID，发出前转成数字
    // （与题目接口同一口径；发字符串服务端绑定不上，会直接 400）。
    difficultyTagId: Number(input.difficultyTagId),
    tagIds: input.tagIds.map(Number),
    prompt: input.prompt,
  });

  return toAiGenerationResult(res);
}
