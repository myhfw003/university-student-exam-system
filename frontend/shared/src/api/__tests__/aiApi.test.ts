/* ==========================================================================
   AI 生成试题接口的适配
   --------------------------------------------------------------------------
   两件事要在这一层做对：

   1. **供应商列表照原样透出**：服务端会列出没配 API Key 的供应商
      （`configured: false`），界面据此提示「服务端未配置」——
      这一层把它抹掉，功能就变成了「界面装作没有这个功能」。
   2. **逐题结论不丢**：生成结果里每道题要么落成了候选题、要么带失败原因，
      失败原因被拍平成字符串数组，页面直接显示。
   ========================================================================== */

import { describe, expect, it, vi } from "vitest";
import {
  AI_GENERATION_TIMEOUT_MS,
  generateAiQuestions,
  loadAiProviders,
  toAiGenerationResult,
  type AiClient,
} from "../aiApi";

/** 服务端返回的供应商清单。 */
const PROVIDERS = {
  providers: [
    {
      name: "minimax",
      displayName: "MiniMax",
      configured: true,
      defaultModel: "MiniMax-M2.7",
      models: ["MiniMax-M2.7", "MiniMax-M3"],
    },
    {
      name: "other",
      displayName: "另一个服务",
      configured: false,
      defaultModel: "some-model",
      models: ["some-model"],
    },
  ],
};

/** 服务端返回的生成结果。 */
const GENERATION = {
  provider: "minimax",
  providerName: "MiniMax",
  model: "MiniMax-M2.7",
  requested: 2,
  succeeded: 1,
  failed: 1,
  items: [
    {
      index: 1,
      succeeded: true,
      questionId: 900,
      code: "AI-20261126103000-01",
      stem: "TCP 建立连接时采用三次握手，其主要目的是：",
      errors: [],
    },
    {
      index: 2,
      succeeded: false,
      questionId: null,
      code: null,
      stem: "多选题只有一个正确答案",
      errors: ["选项：正确选项数量需要在 2 到 6 之间，当前 1 个。"],
    },
  ],
};

describe("aiApi · 供应商列表", () => {
  it("按 DTO 映射，模型清单原样透出", async () => {
    const get = vi.fn(async (_path: string, _options?: unknown) => PROVIDERS);
    const client = { get, post: vi.fn() } as unknown as AiClient;

    const providers = await loadAiProviders(client);

    expect(get.mock.calls[0]![0]).toBe("/ai/providers");
    expect(providers).toHaveLength(2);
    expect(providers[0]!.name).toBe("minimax");
    expect(providers[0]!.models).toEqual(["MiniMax-M2.7", "MiniMax-M3"]);
    expect(providers[0]!.defaultModel).toBe("MiniMax-M2.7");
  });

  it("没配 API Key 的供应商也列出来，并标成未配置", async () => {
    const get = vi.fn(async (_path: string, _options?: unknown) => PROVIDERS);
    const client = { get, post: vi.fn() } as unknown as AiClient;

    const providers = await loadAiProviders(client);

    // 抹掉这一条，界面上就只剩「没有这个功能」——老师不知道是配置没配。
    expect(providers[1]!.configured).toBe(false);
    expect(providers[1]!.displayName).toBe("另一个服务");
  });
});

describe("aiApi · 生成试题", () => {
  it("按 DTO 映射：逐题结论与失败原因都在", async () => {
    const post = vi.fn(async (_path: string, _body?: unknown) => GENERATION);
    const client = { get: vi.fn(), post } as unknown as AiClient;

    const result = await generateAiQuestions(
      {
        provider: "minimax",
        model: "MiniMax-M2.7",
        count: 2,
        type: "single",
        difficultyTagId: "12",
        tagIds: ["34"],
        prompt: "围绕 TCP 三次握手出单选题",
      },
      client,
    );

    expect(post.mock.calls[0]![0]).toBe("/ai/generations");

    // 标签主键必须发成数字：前端内部是字符串 ID，服务端绑定 long 收不了字符串。
    const body = post.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(body.difficultyTagId).toBe(12);
    expect(body.tagIds).toEqual([34]);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.items[0]!.questionId).toBe("900");
    expect(result.items[0]!.succeeded).toBe(true);
    expect(result.items[1]!.succeeded).toBe(false);
    expect(result.items[1]!.errors[0]).toContain("正确选项");
  });

  it("用长超时：模型调用要几十秒，默认的 15 秒会一直报「请求超时」", async () => {
    const post = vi.fn(async (_path: string, _body?: unknown) => GENERATION);
    const client = { get: vi.fn(), post } as unknown as AiClient;

    await generateAiQuestions(
      {
        provider: "minimax",
        model: "MiniMax-M3",
        count: 8,
        type: "single",
        difficultyTagId: "12",
        tagIds: ["34"],
        prompt: "围绕 TCP 三次握手出单选题",
      },
      client,
    );

    const options = post.mock.calls[0]![2] as { timeoutMs?: number } | undefined;

    // 实测 8 道题要 25–60 秒，15 秒的默认超时会让界面次次报「请求超时」，
    // 而服务端其实已经把题出好了。
    expect(options?.timeoutMs).toBe(AI_GENERATION_TIMEOUT_MS);
    expect(options!.timeoutMs!).toBeGreaterThan(60_000);
  });

  it("空结果也不会崩", () => {
    const result = toAiGenerationResult({});

    expect(result.items).toEqual([]);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
  });
});
