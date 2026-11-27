/* ==========================================================================
   AI 生成：流式消费
   --------------------------------------------------------------------------
   流式最容易错在三处：
     1. 网络包会把一个 SSE 事件劈成两半（解析器必须等齐再处理）；
     2. 事件到达时，题目**必须已经落库**（否则界面上的「已生成」是假的）；
     3. 出错也要推一条事件（HTTP 状态码早已发出去了，改不了）。
   ========================================================================== */

import { afterEach, describe, expect, it, vi } from "vitest";
import { generateAiQuestionsStream } from "../aiApi";

/** 把若干段文本拼成一个可读的流（模拟网络包的任意切分）。 */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
}

/** 造一个 SSE 响应。 */
function sseResponse(chunks: string[]): Response {
  return {
    ok: true,
    status: 200,
    body: streamOf(chunks),
    json: async () => ({}),
  } as unknown as Response;
}

/** 一道题的事件。 */
function questionEvent(index: number, questionId: number): string {
  return (
    `event: question\ndata: {"index":${index},"succeeded":true,"questionId":${questionId},` +
    `"code":"AI-1","type":"single","stem":"第 ${index} 道","score":5,"errors":[]}\n\n`
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateAiQuestionsStream · 消费 SSE", () => {
  it("一道道回调，结束时给出汇总", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        questionEvent(1, 101),
        questionEvent(2, 102),
        'event: done\ndata: {"requested":2,"succeeded":2,"failed":0,"provider":"minimax",' +
          '"providerName":"MiniMax","model":"MiniMax-M3.1-Flash"}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const questions: number[] = [];
    // 用容器装：回调里的赋值 TS 的控制流分析看不到。
    const summaries: { requested: number; succeeded: number }[] = [];

    await generateAiQuestionsStream(
      {
        provider: "minimax",
        model: "MiniMax-M3.1-Flash",
        count: 2,
        type: "single",
        difficultyTagId: "12",
        tagIds: [],
        prompt: "出题",
      },
      {
        onQuestion: (item) => questions.push(item.index),
        onDone: (s) => {
          summaries.push(s);
        },
      },
    );

    // 题目是一道道来的，不是一次性全到。
    expect(questions).toEqual([1, 2]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.requested).toBe(2);
    expect(summaries[0]?.succeeded).toBe(2);
  });

  it("事件被网络包劈开也能正确解析", async () => {
    const full = questionEvent(1, 101);
    const cut = Math.floor(full.length / 2);

    const fetchMock = vi.fn(async () => sseResponse([full.slice(0, cut), full.slice(cut)]));
    vi.stubGlobal("fetch", fetchMock);

    const questions: string[] = [];

    await generateAiQuestionsStream(
      {
        provider: "minimax",
        model: "MiniMax-M3.1-Flash",
        count: 1,
        type: "single",
        difficultyTagId: "12",
        tagIds: [],
        prompt: "出题",
      },
      {
        onQuestion: (item) => questions.push(item.stem ?? ""),
      },
    );

    expect(questions).toEqual(["第 1 道"]);
  });

  it("没过校验的题走 onFailed", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'event: failed\ndata: {"index":1,"succeeded":false,"questionId":null,"code":null,' +
          '"type":null,"stem":null,"score":null,"errors":["选项：客观题必须填写选项。"]}\n\n',
        'event: done\ndata: {"requested":1,"succeeded":0,"failed":1,"provider":"minimax",' +
          '"providerName":"MiniMax","model":"MiniMax-M3.1-Flash"}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const failures: string[][] = [];

    await generateAiQuestionsStream(
      {
        provider: "minimax",
        model: "MiniMax-M3.1-Flash",
        count: 1,
        type: "single",
        difficultyTagId: "12",
        tagIds: [],
        prompt: "出题",
      },
      {
        onFailed: (item) => failures.push(item.errors),
      },
    );

    expect(failures).toEqual([["选项：客观题必须填写选项。"]]);
  });

  it("流里的错误事件要回调 onError", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'event: error\ndata: {"errorCode":27102,"message":"调用 MiniMax 返回 500。"}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const errors: { errorCode: number; message: string }[] = [];

    await generateAiQuestionsStream(
      {
        provider: "minimax",
        model: "MiniMax-M3.1-Flash",
        count: 1,
        type: "single",
        difficultyTagId: "12",
        tagIds: [],
        prompt: "出题",
      },
      {
        onError: (e) => errors.push(e),
      },
    );

    expect(errors).toEqual([{ errorCode: 27102, message: "调用 MiniMax 返回 500。" }]);
  });

  it("响应不是 2xx 时抛错，并说清是哪个字段不合法", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      body: null,
      json: async () => ({
        errorCode: 20001,
        title: "请求参数校验失败。",
        status: 400,
        errors: { Prompt: ["出题要求过长。"], TagIds: ["知识点标签不能超过 5 个。"] },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    // 光一句「请求参数校验失败」没人知道是哪儿错了。
    await expect(
      generateAiQuestionsStream(
        {
          provider: "minimax",
          model: "MiniMax-M3.1-Flash",
          count: 50,
          type: "single",
          difficultyTagId: "12",
          tagIds: [],
          prompt: "出题",
        },
        {},
      ),
    ).rejects.toThrow(/出题要求：出题要求过长。/);
  });

  it("标签主键发的是数字而不是字符串", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      sseResponse([]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await generateAiQuestionsStream(
      {
        provider: "minimax",
        model: "MiniMax-M3.1-Flash",
        count: 1,
        type: "single",
        difficultyTagId: "12",
        tagIds: ["34"],
        prompt: "出题",
      },
      {},
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body));
    expect(body.difficultyTagId).toBe(12);
    expect(body.tagIds).toEqual([34]);
  });
});
