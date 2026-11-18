/* ==========================================================================
   服务端卷面 → 答题者卷面
   --------------------------------------------------------------------------
   服务端已经把选项按考生置换过顺序，但每个选项的键仍是原题键。
   前端按位置重新编号成显示字母，并把「显示字母 → 原题键」记下来。
   ========================================================================== */

import { describe, expect, it } from "vitest";
import type { AttemptSurface } from "../../domain/attempt";
import { buildPaperFromSurface } from "../paper";

/** 一份服务端卷面：题目 11 的选项顺序是 C、A、B（置换过）。 */
function surface(overrides: Partial<AttemptSurface> = {}): AttemptSurface {
  return {
    attemptId: "9001",
    attemptNo: 1,
    targetType: "exam",
    status: "in_progress",
    statusLabel: "进行中",
    serverTime: "2026-11-17T10:00:00Z",
    startedAt: "2026-11-17T10:00:00Z",
    deadlineAt: "2026-11-17T11:00:00Z",
    remainingSeconds: 3600,
    elapsedSeconds: 0,
    timed: true,
    variantKey: "VP-1a2b3c4d",
    questions: [
      {
        id: "11",
        type: "single",
        stem: "题干",
        score: 10,
        options: [
          { key: "C", text: "丙" },
          { key: "A", text: "甲" },
          { key: "B", text: "乙" },
        ],
        tagIds: ["901"],
        difficultyTagId: "900",
        difficulty: "基础",
        sectionTitle: null,
        steps: [],
        attachments: [],
      },
    ],
    answers: {},
    lastClientSeq: 0,
    rules: {
      maxFocusLoss: 3,
      onMaxFocusLoss: "force_submit",
      requireFullScreen: false,
      blockCopyPaste: false,
      blockContextMenu: false,
      showWatermark: true,
      enableHeartbeatCheck: true,
      heartbeatIntervalSeconds: 30,
      heartbeatTimeoutSeconds: 90,
      maxDisconnect: 3,
      earlyEntryMinutes: 0,
    },
    ...overrides,
  };
}

describe("服务端卷面 → 答题者卷面", () => {
  it("按卷面位置把选项重新编号成显示字母", () => {
    const paper = buildPaperFromSurface(surface(), {
      examId: "3",
      studentId: "2023120101",
      mode: "small",
    });

    const item = paper.items[0]!;
    // 第一个选项是原题键 C，显示字母是 A。
    expect(item.displayKeys).toEqual(["C", "A", "B"]);
    expect(item.toOriginal).toEqual({ A: "C", B: "A", C: "B" });
    expect(item.fromOriginal).toEqual({ C: "A", A: "B", B: "C" });
  });

  it("选项顺序与原题键升序不同时标记为已置换", () => {
    const paper = buildPaperFromSurface(surface(), {
      examId: "3",
      studentId: "2023120101",
      mode: "small",
    });
    expect(paper.items[0]!.changed).toBe(true);
  });

  it("顺序与原题键升序一致时不标记为置换", () => {
    const ordered = surface();
    ordered.questions[0]!.options = [
      { key: "A", text: "甲" },
      { key: "B", text: "乙" },
      { key: "C", text: "丙" },
    ];

    const paper = buildPaperFromSurface(ordered, {
      examId: "3",
      studentId: "2023120101",
      mode: "standard",
    });
    expect(paper.items[0]!.changed).toBe(false);
    expect(paper.items[0]!.toOriginal).toEqual({ A: "A", B: "B", C: "C" });
  });

  it("卷面里没有正确答案与解析", () => {
    const paper = buildPaperFromSurface(surface(), {
      examId: "3",
      studentId: "2023120101",
      mode: "small",
    });

    const question = paper.items[0]!.question;
    expect(question.answer).toEqual([]);
    expect(question.analysis).toBe("");
  });

  it("综合题步骤只带题干与分值，不带参考答案", () => {
    const withSteps = surface();
    withSteps.questions[0]!.type = "comprehensive";
    withSteps.questions[0]!.steps = [{ code: "S1", prompt: "说明理由", score: 4 }];

    const paper = buildPaperFromSurface(withSteps, {
      examId: "3",
      studentId: "2023120101",
      mode: "standard",
    });

    expect(paper.items[0]!.question.steps).toEqual([
      { id: "S1", prompt: "说明理由", answer: "", keywords: [], score: 4 },
    ]);
  });

  it("题目的标签带上难度标签（题头要靠它显示难度）", () => {
    const paper = buildPaperFromSurface(surface(), {
      examId: "3",
      studentId: "2023120101",
      mode: "standard",
    });
    expect(paper.items[0]!.question.tags).toEqual(["901", "900"]);
  });

  it("卷号用服务端给的置换身份", () => {
    const paper = buildPaperFromSurface(surface(), {
      examId: "3",
      studentId: "2023120101",
      mode: "small",
    });
    expect(paper.variantKey).toBe("VP-1a2b3c4d");
    expect(paper.variantLabel).toBe("VP-1a2b3c4d");
  });

  it("标准卷的卷号显示为标准卷", () => {
    const paper = buildPaperFromSurface(surface({ variantKey: "STD" }), {
      examId: "3",
      studentId: "2023120101",
      mode: "standard",
    });
    expect(paper.variantLabel).toBe("标准卷");
  });
});
