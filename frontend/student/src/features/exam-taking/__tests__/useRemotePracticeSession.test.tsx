/* ==========================================================================
   HTTP 模式的练习会话
   --------------------------------------------------------------------------
   与考试会话的差别：练习不计时、不置换选项，判分在服务端。

   守住两件事：
   1. 卷面来自服务端，答案上行仍走原题键；
   2. 提交后判分与解析来自服务端反馈，前端只做映射。
   ========================================================================== */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useRemotePracticeSession } from "../useRemotePracticeSession";
import { useStudentStore } from "@/stores/studentStore";
import { usePracticeSessionStore } from "@/stores/practiceSessionStore";

/** 练习开放单 ID。 */
const ASSIGNMENT_ID = "7";
/** 作答会话 ID。 */
const ATTEMPT_ID = "9002";

/** 练习开放单列表。 */
const PRACTICES = {
  items: [
    {
      id: 7,
      title: "计算机网络专项练习",
      paperId: 5,
      paperName: "计算机网络练习卷",
      questionCount: 1,
      totalScore: 10,
      tagNames: ["网络"],
      maxAttempts: 3,
      usedAttempts: 0,
      remainingAttempts: 3,
      feedbackTiming: "immediate",
      reflowMistakes: true,
      suggestedMinutes: 15,
      openAt: null,
      closeAt: null,
      publishedAt: "2026-11-16T10:00:00Z",
      canStart: true,
    },
  ],
  total: 1,
  page: 1,
  size: 200,
};

/** 考生卷面：题目 21 的选项顺序是 C/A/B。 */
const ATTEMPT = {
  attemptId: ATTEMPT_ID,
  attemptNo: 1,
  targetType: "practice",
  status: "in_progress",
  statusLabel: "进行中",
  serverTime: "2026-11-17T10:00:00Z",
  startedAt: "2026-11-17T10:00:00Z",
  deadlineAt: "2026-11-17T23:00:00Z",
  remainingSeconds: 0,
  elapsedSeconds: 0,
  timed: false,
  variantKey: "STD",
  rules: { maxFocusLoss: 3, onMaxFocusLoss: "force_submit" },
  practiceRules: {
    maxAttempts: 3,
    feedbackTiming: "immediate",
    reflowMistakes: true,
    suggestedMinutes: 15,
  },
  questions: [
    {
      questionId: 21,
      code: "Q-21",
      type: "single",
      typeLabel: "单选题",
      stem: "TCP 属于哪一层？",
      options: [
        { key: "C", text: "传输层" },
        { key: "A", text: "网络层" },
        { key: "B", text: "数据链路层" },
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
  lastClientSeq: 0,
};

/** 服务端反馈：正确项原题键是 C。 */
const FEEDBACK = {
  attemptId: ATTEMPT_ID,
  feedbackTiming: "immediate",
  generatedAt: "2026-11-17T10:05:00Z",
  questions: [
    {
      questionId: 21,
      code: "Q-21",
      type: "single",
      typeLabel: "单选题",
      answered: true,
      correct: true,
      score: 10,
      maxScore: 10,
      correctKeys: ["C"],
      referenceAnswer: null,
      analysis: "TCP 是传输层协议。",
      details: [],
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

describe("useRemotePracticeSession · HTTP 模式的练习会话", () => {
  /** 上行到服务端的答案批次。 */
  let uploads: Array<{
    items: Array<{ questionId: number; payload: { selectedOptionKeys?: string[] } }>;
  }> = [];

  beforeEach(() => {
    uploads = [];
    useStudentStore.getState().setStudentId("2023120101");
    usePracticeSessionStore.getState().resetAll();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/system/time")) {
          return json({ serverTime: "2026-11-17T10:00:00Z", monotonicTime: 1 });
        }
        if (url.includes("/practices")) return json(PRACTICES);
        if (url.endsWith("/attempts") && method === "POST") return json(ATTEMPT);
        if (url.includes(`/attempts/${ATTEMPT_ID}/answers`)) {
          uploads.push(JSON.parse(String(init?.body ?? "{}")));
          return json({
            acceptedClientSeq: 1,
            serverTime: "2026-11-17T10:00:00Z",
            remainingSeconds: 0,
            rejected: [],
          });
        }
        if (url.includes(`/attempts/${ATTEMPT_ID}/feedback`)) return json(FEEDBACK);
        if (url.includes(`/attempts/${ATTEMPT_ID}/submit`)) {
          return json({
            attemptId: ATTEMPT_ID,
            status: "submitted",
            statusLabel: "已交卷",
            submittedAt: "2026-11-17T10:05:00Z",
            submitReason: "manual",
            submitReasonLabel: "手动交卷",
            objectiveScore: 10,
            objectiveMax: 10,
            subjectivePending: false,
            totalScore: 10,
            totalMax: 10,
            gradeVisibility: "published",
          });
        }
        if (url.includes(`/attempts/${ATTEMPT_ID}`)) return json(ATTEMPT);
        throw new Error(`未预期的请求：${method} ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 渲染练习会话。 */
  function renderSession() {
    return renderHook(() => useRemotePracticeSession(ASSIGNMENT_ID, true), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    });
  }

  it("卷面来自服务端，练习不置换选项", async () => {
    const { result } = renderSession();

    await waitFor(() => {
      expect(result.current.paper).not.toBeNull();
    });

    expect(result.current.practice?.name).toBe("计算机网络专项练习");
    expect(result.current.paper!.mode).toBe("standard");
    // 选项顺序照服务端给的来（练习不置换）。
    expect(result.current.paper!.items[0]!.displayKeys).toEqual(["C", "A", "B"]);
  });

  it("选中的显示字母在上行前换成原题键", async () => {
    const { result } = renderSession();

    await waitFor(() => {
      expect(result.current.paper).not.toBeNull();
    });

    // 卷面上第一项是显示字母 A（原题键 C）。
    result.current.choose("21", ["A"]);

    await waitFor(
      () => {
        expect(uploads.length).toBeGreaterThan(0);
      },
      { timeout: 10_000 },
    );

    expect(uploads[0]!.items[0]!.payload.selectedOptionKeys).toEqual(["C"]);
  }, 20_000);

  it("提交后判分来自服务端反馈", async () => {
    const { result } = renderSession();

    await waitFor(() => {
      expect(result.current.paper).not.toBeNull();
    });

    result.current.choose("21", ["A"]);
    result.current.submit();

    await waitFor(
      () => {
        expect(result.current.submitted).toBe(true);
      },
      { timeout: 10_000 },
    );

    const graded = result.current.result!;
    expect(graded.total).toBe(10);
    expect(graded.details[0]!.status).toBe("correct");
    // 服务端给的是原题键，页面要还原成显示字母。
    expect(graded.details[0]!.pickedDisplay).toEqual(["A"]);
  }, 20_000);
});
