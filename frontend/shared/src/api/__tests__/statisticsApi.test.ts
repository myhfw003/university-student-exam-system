/* ==========================================================================
   成绩统计的 DTO 适配
   --------------------------------------------------------------------------
   服务端给的是**比率**（0..1），前端要的是**百分数**（0..100）——
   换算错了，页面上就会出现「及格率 1%」。
   ========================================================================== */

import { describe, expect, it } from "vitest";
import { toExamSessionStatistics } from "../statisticsApi";

describe("statisticsApi · 比率换算", () => {
  it("及格率 / 优秀率 / 得分率 / 正确率 / 掌握度都换算成百分数", () => {
    const stats = toExamSessionStatistics({
      examSessionId: 7,
      examSessionName: "计算机网络期中",
      participantCount: 3,
      submittedCount: 2,
      absentCount: 1,
      averageScore: 72.5,
      maxScore: 90,
      minScore: 55,
      scoreRange: 35,
      passRate: 0.5,
      excellentRate: 1,
      scoreBuckets: [{ label: "90 分以上", count: 1 }],
      typeStatistics: [
        { type: "single", typeLabel: "单选题", answeredCount: 2, averageScore: 72.5, scoreRate: 0.725 },
      ],
      questionStatistics: [
        {
          questionId: 5,
          code: "Q-5",
          type: "single",
          typeLabel: "单选题",
          stem: "题干",
          maxScore: 100,
          answeredCount: 2,
          correctCount: 1,
          correctRate: 0.5,
          averageScore: 72.5,
          mastery: 0.25,
          suggestion: "建议讲评",
        },
      ],
      roster: [
        {
          userId: 3,
          username: "stu1",
          displayName: "张三",
          objectiveScore: 40,
          subjectiveScore: 50,
          totalScore: 90,
          totalMax: 100,
          scoreRate: 0.9,
        },
      ],
    });

    expect(stats.passRate).toBe(50);
    expect(stats.excellentRate).toBe(100);
    expect(stats.typeStatistics[0]?.scoreRate).toBe(72.5);
    expect(stats.questionStatistics[0]?.correctRate).toBe(50);
    expect(stats.questionStatistics[0]?.mastery).toBe(25);
    expect(stats.roster[0]?.scoreRate).toBe(90);
    // 分数与人数不是比率，原样带过。
    expect(stats.averageScore).toBe(72.5);
    expect(stats.participantCount).toBe(3);
  });

  it("比率缺失时是 null（不是 0）", () => {
    const stats = toExamSessionStatistics({
      examSessionId: 7,
      passRate: null,
      excellentRate: null,
      typeStatistics: [{ type: "single", answeredCount: 0, scoreRate: null }],
      questionStatistics: [{ questionId: 5, correctRate: null, mastery: null }],
      roster: [],
    });

    expect(stats.passRate).toBeNull();
    expect(stats.excellentRate).toBeNull();
    expect(stats.typeStatistics[0]?.scoreRate).toBeNull();
    expect(stats.questionStatistics[0]?.correctRate).toBeNull();
  });
});
