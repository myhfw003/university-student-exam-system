/* ==========================================================================
   HTTP 模式的成绩报告
   --------------------------------------------------------------------------
   成绩由服务端判完再下发，前端不重算。这里守住两件事：

   1. **选择键**：服务端给的是原题键，报告要还原成考生看到的显示字母；
   2. **答案公布策略**：没到公布时机，正确答案与解析一律不显示。
   ========================================================================== */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useExamReport } from "../useExamReport";

/** 后端场次 ID。 */
const SESSION_ID = "3";
/** 后端作答会话 ID。 */
const ATTEMPT_ID = "9001";

/** 场次详情。 */
const SESSION = {
  session: {
    id: 3,
    name: "计算机网络期中考试",
    paperId: 5,
    paperName: "计算机网络期中试卷",
    status: "closed",
    statusLabel: "已结束",
    openAt: "2026-11-17T09:00:00Z",
    closeAt: "2026-11-17T12:00:00Z",
    durationMinutes: 60,
    participantMode: "direct",
    participantModeLabel: "指定考生",
    variantRule: "small_plum",
    variantRuleLabel: "小梅花",
    publishedAt: "2026-11-16T10:00:00Z",
    createdAt: "2026-11-16T10:00:00Z",
  },
  snapshotId: 9,
  rules: { maxFocusLoss: 3, onMaxFocusLoss: "force_submit" },
  note: "考生须知",
  participantTagIds: [],
  participantUserIds: [],
};

/** 考生卷面：题目 11 的选项顺序是 C/A/B（服务端置换过）。 */
const ATTEMPT = {
  attemptId: ATTEMPT_ID,
  attemptNo: 1,
  targetType: "exam",
  status: "submitted",
  statusLabel: "已交卷",
  serverTime: "2026-11-17T10:30:00Z",
  startedAt: "2026-11-17T10:00:00Z",
  deadlineAt: "2026-11-17T11:00:00Z",
  remainingSeconds: 0,
  elapsedSeconds: 1800,
  timed: true,
  variantKey: "VP-abc",
  rules: { maxFocusLoss: 3, onMaxFocusLoss: "force_submit" },
  questions: [
    {
      questionId: 11,
      code: "Q-11",
      type: "single",
      typeLabel: "单选题",
      stem: "计算机网络中最基本的分层模型是？",
      options: [
        { key: "C", text: "丙" },
        { key: "A", text: "甲" },
        { key: "B", text: "乙" },
      ],
      score: 10,
      difficulty: "基础",
      sectionTitle: null,
      attachments: [],
      tagIds: [],
      difficultyTagId: 0,
      steps: [],
    },
  ],
  answers: [],
  lastClientSeq: 1,
};

/** 我的成绩：这一场考过一次。 */
const RESULTS = {
  items: [
    {
      attemptId: 9001,
      examName: "计算机网络期中考试",
      attemptNo: 1,
      submittedAt: "2026-11-17T10:30:00Z",
      totalScore: 10,
      totalMax: 10,
      subjectivePending: false,
      status: "published",
      examSessionId: 3,
      practiceAssignmentId: null,
    },
  ],
  total: 1,
};

/** 成绩报告。 */
const REPORT = {
  attemptId: ATTEMPT_ID,
  attemptNo: 1,
  examName: "计算机网络期中考试",
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
      questionId: 11,
      paperItemId: 1,
      questionCode: "Q-11",
      type: "single",
      typeLabel: "单选题",
      stem: "计算机网络中最基本的分层模型是？",
      yourAnswer: { selectedOptionKeys: ["C"], text: null, steps: null },
      correctKeys: ["C"],
      referenceAnswer: null,
      analysis: "解析在此。",
      score: 10,
      maxScore: 10,
      revealed: true,
    },
  ],
};

/** 造一个最小可用的 JSON 响应。 */
function json(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

describe("useExamReport · HTTP 模式的成绩报告", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/system/time")) {
          return json({ serverTime: "2026-11-17T10:30:00Z", monotonicTime: 1 });
        }
        if (url.includes(`/exam-sessions/${SESSION_ID}`)) return json(SESSION);
        if (url.includes("/my/results")) return json(RESULTS);
        if (url.includes(`/attempts/${ATTEMPT_ID}/report`)) return json(REPORT);
        if (url.includes(`/attempts/${ATTEMPT_ID}`)) return json(ATTEMPT);
        throw new Error(`未预期的请求：${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 渲染成绩报告 hook。 */
  function renderReport() {
    // 显式打开 HTTP 模式：测试环境里构建期环境变量拿不到。
    return renderHook(() => useExamReport(SESSION_ID, true), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    });
  }

  it("读出服务端成绩并把原题键还原成显示字母", async () => {
    const { result } = renderReport();

    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });

    const data = result.current.data!;
    expect(data.examName).toBe("计算机网络期中考试");
    expect(data.mode).toBe("small");
    expect(data.graded.total).toBe(10);

    const detail = data.graded.details[0]!;
    // 服务端的原题键 C，在卷面上是显示字母 A。
    expect(detail.pickedDisplay).toEqual(["A"]);
    expect(detail.correct).toEqual(["C"]);
    expect(detail.status).toBe("correct");
  });

  it("答案未公布时不显示正确答案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes(`/attempts/${ATTEMPT_ID}/report`)) {
          return json({
            ...REPORT,
            answersRevealed: false,
            details: [{ ...REPORT.details[0], revealed: false, correctKeys: [], analysis: null }],
          });
        }
        if (url.includes("/system/time")) {
          return json({ serverTime: "2026-11-17T10:30:00Z", monotonicTime: 1 });
        }
        if (url.includes(`/exam-sessions/${SESSION_ID}`)) return json(SESSION);
        if (url.includes("/my/results")) return json(RESULTS);
        if (url.includes(`/attempts/${ATTEMPT_ID}`)) return json(ATTEMPT);
        throw new Error(`未预期的请求：${url}`);
      }),
    );

    const { result } = renderReport();

    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });

    const detail = result.current.data!.graded.details[0]!;
    expect(detail.correct).toEqual([]);
    expect(detail.question.analysis).toBe("");
  });
});
