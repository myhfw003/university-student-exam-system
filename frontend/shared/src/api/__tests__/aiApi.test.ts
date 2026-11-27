/* ==========================================================================
   AI 生成试题接口的适配（非流式）
   --------------------------------------------------------------------------
   流式的消费在 aiStream.test.ts；这里只管一次性返回的那条路与 SSE 分块解析。
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
  AI_MAX_COUNT,
  AI_MAX_TAGS,
  AI_PROMPT_MAX_LENGTH,
  describeValidationErrors,
  generateAiQuestions,
  loadAiProviders,
  parseSseBlock,
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
      defaultModel: "MiniMax-M3.1-Flash",
      models: ["MiniMax-M3.1-Flash", "MiniMax-M3"],
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
  model: "MiniMax-M3.1-Flash",
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
    expect(providers[0]!.models).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
    expect(providers[0]!.defaultModel).toBe("MiniMax-M3.1-Flash");
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
        model: "MiniMax-M3.1-Flash",
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
    // 第三个参数是请求配置（超时等）：httpClient.post(path, body, options)。
    const post = vi.fn(async (_path: string, _body?: unknown, _options?: unknown) => GENERATION);
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

describe("parseSseBlock · 解析一段 SSE", () => {
  it("取出事件名与数据", () => {
    const block = 'event: question\ndata: {"index":1,"succeeded":true}';

    const parsed = parseSseBlock(block);

    expect(parsed?.event).toBe("question");
    expect(parsed?.data).toBe('{"index":1,"succeeded":true}');
  });

  it("多行 data 拼回一起", () => {
    const block = 'event: done\ndata: {"a":1,\ndata: "b":2}';

    const parsed = parseSseBlock(block);

    expect(parsed?.data).toBe('{"a":1,\n"b":2}');
  });

  it("没有 data 的块不算事件", () => {
    expect(parseSseBlock("event: ping")).toBeNull();
  });

  it("没有 event 时默认是 message", () => {
    const parsed = parseSseBlock('data: {"x":1}');

    expect(parsed?.event).toBe("message");
  });
});

describe("describeValidationErrors · 把字段级错误翻成人话", () => {
  // 2026-11-26 公测机上老师点「生成候选题」收到 400，界面上只有一句
  // 「请求参数校验失败」——既不知道是数量超了还是标签选多了，排查只能靠猜。
  it("把字段名翻成中文并带上原因", () => {
    const message = describeValidationErrors({ Count: ["一次最多生成 10 道题。"] });

    expect(message).toBe("生成数量：一次最多生成 10 道题。");
  });

  it("多个字段用分号隔开", () => {
    const message = describeValidationErrors({
      Prompt: ["出题要求过长。"],
      TagIds: ["知识点标签不能超过 5 个。"],
    });

    expect(message).toBe("出题要求：出题要求过长。；知识点标签：知识点标签不能超过 5 个。");
  });

  it("同一个字段有多条原因时用顿号隔开", () => {
    const message = describeValidationErrors({ Prompt: ["请填写出题要求。", "出题要求过长。"] });

    expect(message).toBe("出题要求：请填写出题要求。、出题要求过长。");
  });

  it("没有字段级错误时不编一句话", () => {
    expect(describeValidationErrors(undefined)).toBeUndefined();
    expect(describeValidationErrors({})).toBeUndefined();
  });

  it("认不出的字段名原样带出来，不吞掉", () => {
    const message = describeValidationErrors({ SomethingNew: ["出了点问题。"] });

    expect(message).toBe("SomethingNew：出了点问题。");
  });
});

describe("AI 生成的数量上限常量", () => {
  // 这三个常量与服务端 `AiGenerationRequestRules` 是同一份限制：
  // 界面先按它们拦一道，服务端再按同一套放行或拒绝。
  // 两边对不上就会出现「界面上能填、服务端却拒」的尴尬——
  // 2026-11-26 公测机上就是老师把「生成数量」填出了服务端允许的范围、
  // 被服务端按「一次最多 10 道题」拒了。
  it("与服务端限制一致", () => {
    expect(AI_MAX_COUNT).toBe(10);
    expect(AI_PROMPT_MAX_LENGTH).toBe(2000);
    expect(AI_MAX_TAGS).toBe(5);
  });
});
