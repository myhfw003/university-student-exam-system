import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerBatch } from "@exam/shared/domain/attempt";
import { NetworkUnavailableError, SyncEngine } from "../syncEngine";
import { MockAnswerTransport } from "../transports";
import {
  clearDraft,
  listBatches,
  loadDraft,
  resetDraftStore,
  saveDraft,
} from "../../stores/draftQueue";

const ATTEMPT_ID = "9001";

describe("SyncEngine · 上行同步", () => {
  let transport: MockAnswerTransport;
  let engine: SyncEngine;

  beforeEach(async () => {
    // 每次测试前清空本地存储，避免用例之间共享草稿与队列。
    await resetDraftStore();
    transport = new MockAnswerTransport();
    engine = new SyncEngine({ attemptId: ATTEMPT_ID, transport });
  });

  afterEach(() => {
    engine.dispose();
    vi.useRealTimers();
  });

  it("首次上行的 clientSeq 从 1 开始并逐次递增", async () => {
    engine.recordAnswer("q-1", { selectedOptionKey: "A" });
    await engine.flush();

    engine.recordAnswer("q-2", { selectedOptionKey: "B" });
    await engine.flush();

    const batches = await listBatches(ATTEMPT_ID);
    // 两个批次都已被服务端接受，队列已清空——改为直接查服务端状态。
    expect(batches).toHaveLength(0);
    const remote = await transport.fetchRemote(ATTEMPT_ID);
    expect(remote.lastClientSeq).toBe(2);
    expect(remote.answers["q-1"]).toEqual({ selectedOptionKey: "A" });
    expect(remote.answers["q-2"]).toEqual({ selectedOptionKey: "B" });
  });

  it("上行前先落盘 IndexedDB，刷新不丢答案", async () => {
    engine.recordAnswer("q-7", { text: "我的作答" });
    await engine.flush();

    const draft = await loadDraft(ATTEMPT_ID);
    expect(draft).not.toBeNull();
    expect(draft?.answers["q-7"]).toEqual({ text: "我的作答" });
  });

  it("服务端已接受的批次从队列删除", async () => {
    engine.recordAnswer("q-1", { selectedOptionKey: "A" });
    await engine.flush();

    expect(await listBatches(ATTEMPT_ID)).toHaveLength(0);
  });

  it("网络不可用时批次留在队列，且标记为离线", async () => {
    const failing = new SyncEngine({
      attemptId: ATTEMPT_ID,
      transport: {
        async send() {
          throw new NetworkUnavailableError();
        },
        async fetchRemote() {
          return { lastClientSeq: 0, answers: {}, submitted: false };
        },
      },
    });

    failing.recordAnswer("q-3", { selectedOptionKey: "C" });
    await failing.flush();

    const batches = await listBatches(ATTEMPT_ID);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.clientSeq).toBe(1);
    failing.dispose();
  });

  it("重放时 clientSeq 保持不变——服务端幂等依据", async () => {
    const sent: number[] = [];
    const flaky: SyncEngine = new SyncEngine({
      attemptId: ATTEMPT_ID,
      transport: {
        async send(batch) {
          sent.push(batch.clientSeq);
          throw new NetworkUnavailableError();
        },
        async fetchRemote() {
          return { lastClientSeq: 0, answers: {}, submitted: false };
        },
      },
    });

    flaky.recordAnswer("q-1", { selectedOptionKey: "A" });
    await flaky.flush();
    await flaky.replay();

    // 两次尝试用的是同一个 clientSeq。
    expect(sent).toEqual([1, 1]);
    flaky.dispose();
  });

  it("对账时服务端答案优先于本地答案", async () => {
    await saveDraft({
      attemptId: ATTEMPT_ID,
      answers: { "q-1": { selectedOptionKey: "A" }, "q-2": { selectedOptionKey: "B" } },
      marked: [],
      currentQuestionId: 1,
      clientSeq: 5,
      updatedAt: new Date().toISOString(),
    });

    // 服务端只有第 1 题，且答案不同。
    const remote = new SyncEngine({
      attemptId: ATTEMPT_ID,
      transport: {
        async send(batch) {
          return batch.clientSeq;
        },
        async fetchRemote() {
          return {
            lastClientSeq: 3,
            answers: { "q-1": { selectedOptionKey: "C" } },
            submitted: false,
          };
        },
      },
    });

    const result = await remote.reconcile();

    // 服务端有的以服务端为准。
    expect(result.answers["q-1"]).toEqual({ selectedOptionKey: "C" });
    // 服务端没有但本地有的保留，等待重放。
    expect(result.answers["q-2"]).toEqual({ selectedOptionKey: "B" });
    remote.dispose();
  });

  it("对账后本地 clientSeq 从服务端 lastClientSeq 之后继续", async () => {
    const sentSeqs: number[] = [];
    const remote = new SyncEngine({
      attemptId: ATTEMPT_ID,
      transport: {
        async send(batch) {
          sentSeqs.push(batch.clientSeq);
          return batch.clientSeq;
        },
        async fetchRemote() {
          return { lastClientSeq: 9, answers: {}, submitted: false };
        },
      },
    });

    await remote.reconcile();
    remote.recordAnswer("q-1", { selectedOptionKey: "A" });
    await remote.flush();

    // 服务端已到 9，本地新批次必须从 10 开始，不能复用旧序号。
    expect(sentSeqs).toEqual([10]);
    remote.dispose();
  });

  it("提交后清理草稿", async () => {
    engine.recordAnswer("q-1", { selectedOptionKey: "A" });
    await engine.flush();
    expect(await loadDraft(ATTEMPT_ID)).not.toBeNull();

    await clearDraft(ATTEMPT_ID);
    expect(await loadDraft(ATTEMPT_ID)).toBeNull();
  });

  it("答案在上行防抖到期后自动上行，不必等切题", async () => {
    engine.recordAnswer("q-1", { selectedOptionKey: "A" });

    // 上行防抖 3 秒（落盘防抖 300ms 不该把待发条目带走）。
    await new Promise((resolve) => setTimeout(resolve, 3500));

    const remote = await transport.fetchRemote(ATTEMPT_ID);
    expect(remote.answers["q-1"]).toEqual({ selectedOptionKey: "A" });
  }, 15_000);

  it("单批最多 50 条，超出拆成多批", async () => {
    const sentSizes: number[] = [];
    const recording = {
      async send(batch: AnswerBatch) {
        sentSizes.push(batch.items.length);
        return batch.clientSeq;
      },
      async fetchRemote() {
        return { lastClientSeq: 0, answers: {}, submitted: false };
      },
    };
    const splitter = new SyncEngine({ attemptId: ATTEMPT_ID, transport: recording });

    for (let i = 0; i < 60; i += 1) {
      splitter.recordAnswer(`q-${i}`, { selectedOptionKey: "A" });
    }
    await splitter.flush();

    // 60 条要拆成 50 + 10 两批（服务端单批上限 50）。
    expect(sentSizes).toEqual([50, 10]);
    splitter.dispose();
  });
});
