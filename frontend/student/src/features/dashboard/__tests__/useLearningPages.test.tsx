/* ==========================================================================
   HTTP 模式的错题本与工作台
   --------------------------------------------------------------------------
   两处的统计口径都在服务端，前端不重算：
   - 错题本：题���、题型、标签、错因、错次都是服务端给的；
   - 工作台：待完成练习、进行中考试、学期平均分、待订正错题、
     推荐练习、最近成绩、成绩趋势与错题分布都是服务端算好的。
   ========================================================================== */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useRemoteMistakeList } from "@/features/mistakes/useMistakeList";
import { useDashboard } from "../useDashboard";

/** 错题本响应。 */
const MISTAKES = {
  items: [
    {
      id: 1,
      questionId: 11,
      questionCode: "Q-11",
      questionType: "single",
      questionTypeLabel: "单选题",
      stem: "TCP 属于哪一层？",
      tagNames: ["网络"],
      wrongCount: 2,
      reason: "option_mismatch",
      reasonLabel: "选项判断错误",
      sourceType: "exam",
      sourceTypeLabel: "考试",
      lastWrongAt: "2026-11-17T10:00:00Z",
      resolvedAt: null,
      sourceAttemptId: 9001,
    },
  ],
  total: 1,
  page: 1,
  size: 200,
};

/** 工作台汇总响应。 */
const DASHBOARD = {
  pendingPractices: 2,
  ongoingExams: 1,
  termAverageScore: 86.5,
  pendingMistakes: 3,
  ongoingExam: {
    examSessionId: 3,
    name: "计算机网络期中考试",
    openAt: "2026-11-17T09:00:00Z",
    closeAt: "2026-11-17T12:00:00Z",
    note: "考生须知",
    started: true,
  },
  recommendedPractices: [{ id: 7, title: "计算机网络专项练习", tagNames: ["网络"] }],
  recentResults: [
    {
      attemptId: 9001,
      kind: "exam",
      name: "计算机网络期中考试",
      date: "2026-11-17T10:00:00Z",
      score: 10,
      total: 10,
      status: "published",
    },
  ],
  scoreTrend: [{ date: "2026-11-17T10:00:00Z", score: 10, total: 10 }],
  mistakeDistribution: [{ tagName: "网络", group: "知识点", count: 3 }],
  generatedAt: "2026-11-17T10:00:00Z",
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

describe("错题本与工作台 · HTTP 模式", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/mistakes")) return json(MISTAKES);
        if (url.includes("/dashboard/summary")) return json(DASHBOARD);
        throw new Error(`未预期的请求：${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("错题本读服务端的题面、错因与错次", async () => {
    const { result } = renderHook(() => useRemoteMistakeList(true, {}), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    });

    await waitFor(() => {
      expect(result.current.rows.length).toBeGreaterThan(0);
    });

    const row = result.current.rows[0]!;
    expect(row.questionId).toBe("11");
    expect(row.stem).toBe("TCP 属于哪一层？");
    expect(row.reason).toBe("选项判断错误");
    expect(row.wrongCount).toBe(2);
  });

  it("工作台读服务端的统计口径", async () => {
    const { result } = renderHook(() => useDashboard(true), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    });

    await waitFor(() => {
      expect(result.current.summary).not.toBeNull();
    });

    const summary = result.current.summary!;
    expect(summary.pendingPractices).toBe(2);
    expect(summary.ongoingExams).toBe(1);
    expect(summary.termAverageScore).toBe(86.5);
    expect(summary.pendingMistakes).toBe(3);
    expect(summary.ongoingExam?.examSessionId).toBe("3");
    expect(summary.recommendedPractices[0]?.id).toBe("7");
    expect(summary.recentResults[0]?.date).toBe("2026-11-17");
    expect(summary.mistakeDistribution[0]?.count).toBe(3);
  });
});
