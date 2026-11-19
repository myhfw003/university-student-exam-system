/* ==========================================================================
   管理端成绩分析 · HTTP 模式
   --------------------------------------------------------------------------
   断言的是页面上真正能看到的东西与服务端发出去的请求：
   统计卡片、分数段、逐人明细、逐题正确率都来自服务端的成绩分析。
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/** 被测的 API 函数。 */
const api = {
  loadAdminSessions: vi.fn(),
  loadExamSessionStatistics: vi.fn(),
  previewPaper: vi.fn(),
};

vi.mock("@exam/shared/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBackendEnabled: () => true,
  ...api,
}));

const { AnalyticsPage } = await import("../AnalyticsPage");

/** 服务端的场次清单。 */
const SESSIONS = [
  {
    id: "7",
    name: "计算机网络期中",
    paperId: "12",
    paperName: "期中考试卷",
    status: "closed",
    statusLabel: "已结束",
    openAt: "2026-11-18T08:00:00Z",
    closeAt: "2026-11-18T10:00:00Z",
    durationMinutes: 60,
    participantMode: "tags",
    participantModeLabel: "按组织标签",
    variantRule: "small_plum",
    variantRuleLabel: "小梅花",
    publishedAt: "2026-11-18T07:50:00Z",
    createdAt: "2026-11-17T09:00:00Z",
  },
];

/** 服务端的成绩分析。 */
const STATISTICS = {
  examSessionId: "7",
  examSessionName: "计算机网络期中",
  participantCount: 3,
  submittedCount: 2,
  absentCount: 1,
  averageScore: 72.5,
  maxScore: 90,
  minScore: 55,
  scoreRange: 35,
  passRate: 50,
  excellentRate: 50,
  scoreBuckets: [
    { label: "90 分以上", count: 1 },
    { label: "80–90", count: 0 },
    { label: "70–80", count: 0 },
    { label: "60–70", count: 0 },
    { label: "60 分以下", count: 1 },
  ],
  typeStatistics: [
    { type: "single", typeLabel: "单选题", answeredCount: 2, averageScore: 72.5, scoreRate: 72.5 },
  ],
  questionStatistics: [
    {
      questionId: "5",
      code: "Q-5",
      type: "single",
      typeLabel: "单选题",
      stem: "TCP 属于哪一层协议？",
      maxScore: 100,
      answeredCount: 2,
      correctCount: 1,
      correctRate: 50,
      averageScore: 72.5,
      mastery: 50,
      suggestion: "建议讲评",
    },
  ],
  roster: [
    {
      userId: "3",
      username: "stu1",
      displayName: "张三",
      objectiveScore: 40,
      subjectiveScore: 50,
      totalScore: 90,
      totalMax: 100,
      scoreRate: 90,
      submittedAt: "2026-11-18T09:30:00Z",
    },
    {
      userId: "4",
      username: "stu2",
      displayName: "李四",
      objectiveScore: 30,
      subjectiveScore: 25,
      totalScore: 55,
      totalMax: 100,
      scoreRate: 55,
      submittedAt: "2026-11-18T09:40:00Z",
    },
  ],
  updatedAt: "2026-11-18T10:05:00Z",
};

describe("管理端成绩分析 · HTTP 模式", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.loadAdminSessions.mockResolvedValue(SESSIONS);
    api.loadExamSessionStatistics.mockResolvedValue(STATISTICS);
    api.previewPaper.mockResolvedValue({
      variantKey: "v1",
      rule: "small_plum",
      ruleLabel: "小梅花",
      itemCount: 1,
      totalScore: 100,
      items: [],
    });
  });

  it("统计卡片用服务端的成绩分析（比率换算成百分数）", async () => {
    render(
      <MemoryRouter initialEntries={["/analytics"]}>
        <Routes>
          <Route path="*" element={<AnalyticsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(api.loadExamSessionStatistics).toHaveBeenCalledWith("7");
    });

    // 平均分 72.5、最高 / 最低 90 / 55。
    await waitFor(() => {
      expect(screen.getAllByText("72.5").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("90 / 55")).toBeInTheDocument();
    // 及格率：服务端给的是比率，API 层换算成百分数。
    expect(screen.getByText("2 / 3 人")).toBeInTheDocument();
  });

  it("逐人明细与逐题正确率来自服务端", async () => {
    render(
      <MemoryRouter initialEntries={["/analytics"]}>
        <Routes>
          <Route path="*" element={<AnalyticsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("张三")).toBeInTheDocument();
    });
    expect(screen.getByText("李四")).toBeInTheDocument();
    // 总分 90 排第一。
    expect(screen.getByText("90 / 100")).toBeInTheDocument();
    // 逐题正确率 50%。
    expect(screen.getAllByText("50%").length).toBeGreaterThan(0);
    expect(screen.getByText("TCP 属于哪一层协议？")).toBeInTheDocument();
  });

  it("没有成绩明细时给出空态", async () => {
    api.loadExamSessionStatistics.mockResolvedValue({
      ...STATISTICS,
      roster: [],
      questionStatistics: [],
    });

    render(
      <MemoryRouter initialEntries={["/analytics"]}>
        <Routes>
          <Route path="*" element={<AnalyticsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("还没有成绩记录")).toBeInTheDocument();
    });
  });
});
