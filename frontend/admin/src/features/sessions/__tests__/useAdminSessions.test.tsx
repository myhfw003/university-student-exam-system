/* ==========================================================================
   管理端场次数据通路 · HTTP 模式
   --------------------------------------------------------------------------
   覆盖三件事：
   1. 列表行按后端摘要映射（状态、卷型、名单纳入方式）；
   2. 详情把后端的 `rules` 翻译成前端的防作弊策略，名单与成绩各自成行；
   3. 保存策略时把前端策略翻译回后端规则。
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/** 被测的 API 函数。 */
const api = {
  loadAdminSessions: vi.fn(),
  loadAdminSession: vi.fn(),
  loadSessionParticipants: vi.fn(),
  loadSessionGrades: vi.fn(),
  updateAdminSession: vi.fn(),
  publishAdminSession: vi.fn(),
  closeAdminSession: vi.fn(),
  cancelAdminSession: vi.fn(),
  createAdminSession: vi.fn(),
};

vi.mock("@exam/shared/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // 固定走 HTTP 通路：环境变量在测试里是静态快照，切不动。
  isBackendEnabled: () => true,
  ...api,
}));

const { useAdminSessionDetail, useAdminSessionList } = await import("../useAdminSessions");

/** 后端场次摘要。 */
const SUMMARY = {
  id: "12",
  name: "计算机网络期中考试 · 第 2 场",
  paperId: "3",
  paperName: "计算机网络期中试卷",
  status: "in_progress",
  statusLabel: "进行中",
  openAt: "2026-11-20T08:30:00Z",
  closeAt: "2026-11-20T12:00:00Z",
  durationMinutes: 90,
  participantMode: "tags",
  participantModeLabel: "按组织标签",
  variantRule: "small_plum",
  variantRuleLabel: "小梅花",
  publishedAt: "2026-11-19T10:00:00Z",
  createdAt: "2026-11-18T10:00:00Z",
};

/** 后端场次详情。 */
const DETAIL = {
  summary: SUMMARY,
  snapshotId: 88,
  rules: {
    maxFocusLoss: 3,
    onMaxFocusLoss: "force_submit",
    requireFullScreen: true,
    blockCopyPaste: true,
    blockContextMenu: false,
    showWatermark: true,
    enableHeartbeatCheck: true,
    heartbeatIntervalSeconds: 20,
    heartbeatTimeoutSeconds: 60,
    maxDisconnect: 3,
    earlyEntryMinutes: 0,
  },
  note: "开考后不要切屏",
  participantTagIds: ["5", "6"],
  participantUserIds: [],
};

describe("管理端场次 · HTTP 模式", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.loadAdminSessions.mockResolvedValue([SUMMARY]);
    api.loadAdminSession.mockResolvedValue(DETAIL);
    api.loadSessionParticipants.mockResolvedValue([
      {
        userId: "101",
        username: "s101",
        displayName: "林知遥",
        status: "in_progress",
        statusLabel: "作答中",
        attemptsUsed: 1,
      },
    ]);
    api.loadSessionGrades.mockResolvedValue([
      {
        attemptId: "9001",
        attemptNo: 1,
        userId: "101",
        studentUsername: "s101",
        studentDisplayName: "林知遥",
        objectiveScore: 8,
        objectiveMax: 10,
        totalScore: 8,
        totalMax: 10,
        subjectivePending: false,
        gradeVisibility: "after_close",
        published: false,
        submittedAt: "2026-11-20T10:00:00Z",
      },
    ]);
  });

  it("列表行按后端摘要映射，名单人数留空", async () => {
    const { result } = renderHook(() => useAdminSessionList({ status: "all", keyword: "" }));

    await waitFor(() => {
      expect(result.current.rows.length).toBe(1);
    });

    const row = result.current.rows[0]!;
    expect(row.id).toBe("12");
    expect(row.name).toBe(SUMMARY.name);
    expect(row.status).toBe("in_progress");
    expect(row.durationMin).toBe(90);
    // 列表接口不返回名单人数：不能假装知道。
    expect(row.rosterCount).toBeNull();
    expect(row.rosterModeLabel).toBe("按组织标签");
  });

  it("详情把后端规则翻译成防作弊策略，名单与成绩各自成行", async () => {
    const { result } = renderHook(() => useAdminSessionDetail("12"));

    await waitFor(() => {
      expect(result.current.missing).toBe(false);
    });

    const view = result.current;
    expect(view.name).toBe(SUMMARY.name);
    expect(view.paperName).toBe("计算机网络期中试卷");
    expect(view.mode).toBe("small");
    expect(view.note).toBe("开考后不要切屏");
    expect(view.rosterSource).toContain("2 个标签");

    // 规则翻译：后端字段名 → 前端口径。
    expect(view.policy.maxFocusLoss).toBe(3);
    expect(view.policy.onExceeded).toBe("force_submit");
    expect(view.policy.requireFullscreen).toBe(true);
    expect(view.policy.disableCopyPaste).toBe(true);
    expect(view.policy.disableContextMenu).toBe(false);
    expect(view.policy.watermark).toBe(true);
    expect(view.policy.heartbeatIntervalSec).toBe(20);
    expect(view.policy.disconnectThresholdSec).toBe(60);

    expect(view.roster).toHaveLength(1);
    expect(view.roster[0]!.displayName).toBe("林知遥");
    expect(view.grades).toHaveLength(1);
    expect(view.grades[0]!.score).toBe(8);
    expect(view.grades[0]!.total).toBe(10);
  });

  it("保存策略时把前端策略翻译回后端规则", async () => {
    api.updateAdminSession.mockResolvedValue(DETAIL);

    const { result } = renderHook(() => useAdminSessionDetail("12"));
    await waitFor(() => {
      expect(result.current.missing).toBe(false);
    });

    await result.current.savePolicy({ maxFocusLoss: 5, onExceeded: "warn" });

    expect(api.updateAdminSession).toHaveBeenCalledTimes(1);
    const [, payload] = api.updateAdminSession.mock.calls[0]!;
    expect(payload.rules.maxFocusLoss).toBe(5);
    expect(payload.rules.onMaxFocusLoss).toBe("warn");
    // 其余字段原样带回，不能因为只改一项就丢掉别的配置。
    expect(payload.rules.requireFullScreen).toBe(true);
    expect(payload.participantMode).toBe("tags");
    expect(payload.participantTagIds).toEqual(["5", "6"]);
    expect(payload.variantRule).toBe("small_plum");
  });
});
