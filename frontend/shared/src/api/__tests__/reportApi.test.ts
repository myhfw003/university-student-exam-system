/* ==========================================================================
   成绩与判分依据的接口适配
   --------------------------------------------------------------------------
   成绩报告（`/attempts/{id}/report`）给的是分数与逐题明细；
   **判分依据**在另一个接口（`/attempts/{id}/scores`）：命中了哪些要点、
   漏了哪些、按什么方式判的分。

   这一层要对的三件事：
   1. 分数与总分照服务端给的口径映射；
   2. **「没定分」是 null，不是 0**——成绩没发布时，服务端把主观题那部分
      捂着不给，前端不能拿 0 顶替（0 分与「没出分」是两回事）；
   3. 要点命中与漏掉照原样映射，不自己判断命中与否。
   ========================================================================== */

import { describe, expect, it, vi } from "vitest";
import { loadAttemptScores, type ReportClient } from "../reportApi";

/** 服务端给的逐题成绩。 */
const SCORES = {
  objectiveScore: 10,
  objectiveMax: 10,
  subjectivePending: false,
  totalScore: 15,
  totalMax: 20,
  gradeVisibility: "published",
  items: [
    {
      questionId: 11,
      score: 10,
      maxScore: 10,
      method: "auto_scored",
      methodLabel: "自动判分",
      status: "final",
      statusLabel: "已定分",
      scoredBy: null,
      scoredAt: "2026-11-17T10:30:00Z",
      hitItems: [],
      missedItems: [],
      notes: [],
    },
    {
      questionId: 12,
      score: 5,
      maxScore: 10,
      method: "auto_suggested",
      methodLabel: "自动初判",
      status: "suggested",
      statusLabel: "待确认",
      scoredBy: null,
      scoredAt: "2026-11-17T10:30:00Z",
      hitItems: ["端到端传输"],
      missedItems: ["拥塞控制"],
      notes: [],
    },
  ],
};

describe("reportApi · 逐题成绩与判分依据", () => {
  it("读成绩走 GET /attempts/{id}/scores", async () => {
    const get = vi.fn(async (_path: string) => SCORES);
    const client = { get } as unknown as ReportClient;

    const scores = await loadAttemptScores("9001", client);

    expect(get.mock.calls[0]![0]).toBe("/attempts/9001/scores");
    expect(scores.gradeVisibility).toBe("published");
    expect(scores.objectiveScore).toBe(10);
    expect(scores.totalScore).toBe(15);
    expect(scores.totalMax).toBe(20);
    expect(scores.subjectivePending).toBe(false);
    expect(scores.items).toHaveLength(2);
  });

  it("要点命中与漏掉照服务端给的原样映射", async () => {
    const get = vi.fn(async (_path: string) => SCORES);
    const client = { get } as unknown as ReportClient;

    const scores = await loadAttemptScores("9001", client);

    const subjective = scores.items[1]!;
    expect(subjective.hitItems).toEqual(["端到端传输"]);
    expect(subjective.missedItems).toEqual(["拥塞控制"]);
    expect(subjective.method).toBe("auto_suggested");
    expect(subjective.methodLabel).toBe("自动初判");
    expect(subjective.statusLabel).toBe("待确认");
  });

  it("「没定分」是 null，不拿 0 顶替", async () => {
    const get = vi.fn(async (_path: string) => ({
      ...SCORES,
      gradeVisibility: "objective_only",
      items: [{ ...SCORES.items[1], score: null, hitItems: [], missedItems: [] }],
    }));
    const client = { get } as unknown as ReportClient;

    const scores = await loadAttemptScores("9001", client);

    expect(scores.items[0]!.score).toBeNull();
    // 成绩没发布时服务端把要点命中也捂着——那等于把答案抖出来。
    expect(scores.items[0]!.hitItems).toEqual([]);
  });
});
