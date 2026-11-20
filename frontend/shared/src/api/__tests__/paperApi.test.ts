/* ==========================================================================
   试卷版本快照的接口适配
   --------------------------------------------------------------------------
   快照是**发布时冻结的一份卷面**：发布一次就是一个版本，
   之后改卷不影响已经发出去的版本。

   这一层要对的两件事：
   1. 版本列表里的摘要（版本号、题量、总分、内容指纹）；
   2. 快照详情里冻结的题目——**含正确答案与解析**
      （所以这个接口要的是 `paper:write`，只有出题的人能看）。
   ========================================================================== */

import { describe, expect, it, vi } from "vitest";
import {
  loadLatestPaperSnapshot,
  loadPaperSnapshot,
  loadPaperSnapshots,
  type PaperClient,
} from "../paperApi";

/** 后端返回的快照摘要。 */
const SUMMARY = {
  id: 5,
  paperId: 12,
  version: 2,
  contentHash: "abcdef0123456789",
  itemCount: 1,
  totalScore: 40,
  createdAt: "2026-11-19T09:00:00Z",
  createdBy: 3,
};

/** 后端返回的快照详情。 */
const DETAIL = {
  ...SUMMARY,
  items: [
    {
      id: 30,
      questionId: 5,
      questionCode: "Q-5",
      questionType: "single",
      stem: "TCP 属于哪一层协议？",
      options: [{ key: "A", text: "传输层" }],
      correctKeys: ["A"],
      keypoints: [{ text: "端到端传输", keywords: ["传输"] }],
      steps: [],
      analysis: "传输层负责端到端传输。",
      referenceAnswer: null,
      attachments: [],
      score: 40,
      sortOrder: 1,
      sectionTitle: null,
    },
  ],
};

/** 记录调用参数的假客户端。 */
function fakeClient() {
  const get = vi.fn(async (_path: string, _options?: unknown) => ({ items: [SUMMARY] }));
  const client = { get, post: vi.fn(), put: vi.fn(), delete: vi.fn() } as unknown as PaperClient;
  return { client, get };
}

describe("paperApi · 版本快照", () => {
  it("版本列表按 DTO 映射", async () => {
    const { client, get } = fakeClient();

    const list = await loadPaperSnapshots("12", client);

    expect(get.mock.calls[0]![0]).toBe("/papers/12/snapshots");
    expect(list).toHaveLength(1);
    expect(list[0]!.version).toBe(2);
    expect(list[0]!.itemCount).toBe(1);
    expect(list[0]!.totalScore).toBe(40);
    expect(list[0]!.contentHash).toBe("abcdef0123456789");
  });

  it("快照详情：冻结的题目带正确答案与解析", async () => {
    const get = vi.fn(async (_path: string) => DETAIL);
    const detailClient = { get } as unknown as PaperClient;

    const detail = await loadPaperSnapshot("12", 1, detailClient);

    expect(get.mock.calls[0]![0]).toBe("/papers/12/snapshots/1");
    expect(detail.version).toBe(2);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]!.questionCode).toBe("Q-5");
    expect(detail.items[0]!.stem).toBe("TCP 属于哪一层协议？");
    expect(detail.items[0]!.correctKeys).toEqual(["A"]);
    expect(detail.items[0]!.analysis).toBe("传输层负责端到端传输。");
    expect(detail.items[0]!.options).toEqual([{ key: "A", text: "传输层" }]);
  });

  it("最新一版快照走 /snapshots/latest", async () => {
    const get = vi.fn(async (_path: string) => DETAIL);
    const detailClient = { get } as unknown as PaperClient;

    const detail = await loadLatestPaperSnapshot("12", detailClient);

    expect(get.mock.calls[0]![0]).toBe("/papers/12/snapshots/latest");
    expect(detail.items[0]!.sortOrder).toBe(1);
  });
});
