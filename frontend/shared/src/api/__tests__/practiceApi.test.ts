/* ==========================================================================
   练习开放单的接口适配
   --------------------------------------------------------------------------
   学生端看到的是**练习开放单**：一条开放单挂一份练习卷，开放单自己带
   次数上限、反馈时机与错题回流设置。

   这一层要对的两件事：
   1. 读一条走 `GET /practices/{id}`（与列表里的一项是同一个 DTO，
      区别是只取这一条）；
   2. 字段照服务端给的口径映射——**「不限次数」是 null，不是 0**
      （0 是「最多做 0 次」，两回事）。
   ========================================================================== */

import { describe, expect, it, vi } from "vitest";
import { loadPractice, type PracticeClient } from "../practiceApi";

/** 服务端给的一条练习开放单。 */
const PRACTICE = {
  id: 7,
  title: "计算机网络专项练习",
  paperId: 5,
  paperName: "计算机网络练习卷",
  questionCount: 1,
  totalScore: 10,
  tagNames: ["网络"],
  maxAttempts: 3,
  usedAttempts: 1,
  remainingAttempts: 2,
  feedbackTiming: "immediate",
  reflowMistakes: true,
  suggestedMinutes: 15,
  openAt: null,
  closeAt: null,
  publishedAt: "2026-11-16T10:00:00Z",
  canStart: true,
};

describe("practiceApi · 一条练习开放单", () => {
  it("读一条走 GET /practices/{id}", async () => {
    const get = vi.fn(async (_path: string) => PRACTICE);
    const client = { get } as unknown as PracticeClient;

    const practice = await loadPractice("7", client);

    expect(get.mock.calls[0]![0]).toBe("/practices/7");
    expect(practice.id).toBe("7");
    expect(practice.title).toBe("计算机网络专项练习");
    expect(practice.paperName).toBe("计算机网络练习卷");
    expect(practice.questionCount).toBe(1);
    expect(practice.totalScore).toBe(10);
    expect(practice.tagNames).toEqual(["网络"]);
  });

  it("次数与规则照服务端给的映射：不限次数是 null", async () => {
    const get = vi.fn(async (_path: string) => ({
      ...PRACTICE,
      maxAttempts: 0,
      usedAttempts: 4,
      remainingAttempts: null,
    }));
    const client = { get } as unknown as PracticeClient;

    const practice = await loadPractice("7", client);

    expect(practice.maxAttempts).toBe(0);
    expect(practice.usedAttempts).toBe(4);
    // 不限次数是 null，不是 0。
    expect(practice.remainingAttempts).toBeNull();
    expect(practice.feedbackTiming).toBe("immediate");
    expect(practice.reflowMistakes).toBe(true);
    expect(practice.suggestedMinutes).toBe(15);
    expect(practice.canStart).toBe(true);
  });
});
