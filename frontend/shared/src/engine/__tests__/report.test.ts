/* ==========================================================================
   成绩报告 → 判分明细
   --------------------------------------------------------------------------
   两条口径的守门用例：
   1. **选择键**：服务端给的是原题键，考生看到的是显示字母；
   2. **答案公布策略**：没到公布时机，正确答案与解析一律不给。
   ========================================================================== */

import { describe, expect, it } from "vitest";
import type { AttemptReport, AttemptSurface } from "../../domain/attempt";
import { gradedPaperFromReport } from "../report";

/** 服务端卷面：题目 11 的选项顺序是 C/A/B（置换过）。 */
function surface(): AttemptSurface {
  return {
    attemptId: "9001",
    attemptNo: 1,
    targetType: "exam",
    status: "submitted",
    statusLabel: "已交卷",
    serverTime: "2026-11-17T10:00:00Z",
    startedAt: "2026-11-17T10:00:00Z",
    deadlineAt: "2026-11-17T11:00:00Z",
    remainingSeconds: 0,
    elapsedSeconds: 1800,
    timed: true,
    variantKey: "VP-abc",
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
    lastClientSeq: 1,
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
  };
}

/** 成绩报告（可按需改动单题明细）。 */
function report(overrides: Partial<AttemptReport["details"][number]> = {}): AttemptReport {
  return {
    attemptId: "9001",
    attemptNo: 1,
    examName: "期末考试",
    submittedAt: "2026-11-17T10:30:00Z",
    objectiveScore: 10,
    objectiveMax: 10,
    subjectiveScore: null,
    subjectiveMax: 0,
    totalScore: 10,
    totalMax: 10,
    status: "submitted",
    answersRevealed: true,
    answerPolicy: "immediately",
    details: [
      {
        questionId: "11",
        questionCode: "Q-11",
        type: "single",
        typeLabel: "单选题",
        stem: "题干",
        yourAnswer: { selectedOptionKeys: ["C"] },
        correctKeys: ["C"],
        referenceAnswer: null,
        analysis: "因为丙是对的。",
        score: 10,
        maxScore: 10,
        revealed: true,
        ...overrides,
      },
    ],
  };
}

describe("成绩报告 → 判分明细", () => {
  it("考生的作答换回显示字母", () => {
    const graded = gradedPaperFromReport(surface(), report());
    const detail = graded.details[0]!;

    // 服务端给的是原题键 C，卷面上它的显示字母是 A。
    expect(detail.pickedOriginal).toEqual(["C"]);
    expect(detail.pickedDisplay).toEqual(["A"]);
    // 正确答案保留原题键——展示时再由 fromOriginal 换。
    expect(detail.correct).toEqual(["C"]);
    expect(detail.fromOriginal["C"]).toBe("A");
  });

  it("判分状态按分数与是否作答推出来", () => {
    const correct = gradedPaperFromReport(surface(), report()).details[0]!;
    expect(correct.status).toBe("correct");

    const partial = gradedPaperFromReport(
      surface(),
      report({ score: 4, maxScore: 10 }),
    ).details[0]!;
    expect(partial.status).toBe("partial");

    const wrong = gradedPaperFromReport(
      surface(),
      report({ score: 0, yourAnswer: { selectedOptionKeys: ["A"] } }),
    ).details[0]!;
    expect(wrong.status).toBe("wrong");

    const blank = gradedPaperFromReport(
      surface(),
      report({ score: 0, yourAnswer: null }),
    ).details[0]!;
    expect(blank.status).toBe("blank");

    const pending = gradedPaperFromReport(surface(), report({ score: null })).details[0]!;
    expect(pending.status).toBe("pending");
  });

  it("答案未公布时不给正确答案与解析", () => {
    const graded = gradedPaperFromReport(
      surface(),
      report({ revealed: false, correctKeys: [], analysis: null }),
    );
    const detail = graded.details[0]!;

    expect(detail.correct).toEqual([]);
    expect(detail.question.analysis).toBe("");
  });

  it("总分与待阅题数照服务端来", () => {
    const graded = gradedPaperFromReport(
      surface(),
      report({ score: null, maxScore: 10 }),
    );
    expect(graded.objective).toEqual({ score: 10, max: 10 });
    expect(graded.pendingQuestions).toEqual(["11"]);
  });

  it("题目标签带难度标签", () => {
    const graded = gradedPaperFromReport(surface(), report());
    expect(graded.details[0]!.question.tags).toEqual(["901", "900"]);
  });
});
