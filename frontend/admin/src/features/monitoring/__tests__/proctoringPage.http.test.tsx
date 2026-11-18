/* ==========================================================================
   管理端监考大屏 · HTTP 模式
   --------------------------------------------------------------------------
   断言的是：考生状态来自服务端监考快照、处置按**作答**下发（带上 attemptId）、
   处置记录只列本屏下发的。
   ========================================================================== */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/** 被测的 API 函数。 */
const api = {
  createProctorAction: vi.fn(),
  loadProctorActions: vi.fn(),
  loadAdminSession: vi.fn(),
  loadAdminSessions: vi.fn(),
  loadSessionParticipants: vi.fn(),
  loadSessionGrades: vi.fn(),
  loadUserPage: vi.fn(),
  loadRoles: vi.fn(),
  loadOrgTags: vi.fn(),
};

vi.mock("@exam/shared/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBackendEnabled: () => true,
  ...api,
}));

const { ProctoringPage } = await import("../ProctoringPage");

/** 后端监考快照。 */
const MONITORING = {
  examSessionId: 12,
  serverTime: "2026-11-18T08:00:00Z",
  candidates: [
    {
      attemptId: 9001,
      userId: 101,
      displayName: "林知遥",
      username: "s101",
      status: "in_progress",
      statusLabel: "作答中",
      focusLossCount: 1,
      disconnectCount: 0,
      warningCount: 0,
      lastHeartbeatAt: "2026-11-18T08:00:00Z",
      offline: false,
      answeredCount: 3,
      totalCount: 10,
    },
  ],
};

/** 后端场次详情。 */
const SESSION_DETAIL = {
  summary: {
    id: "12",
    name: "计算机网络期中考试",
    paperId: "3",
    paperName: "计算机网络期中试卷",
    status: "in_progress",
    statusLabel: "进行中",
    openAt: "2026-11-18T08:00:00Z",
    closeAt: "2026-11-18T12:00:00Z",
    durationMinutes: 90,
    participantMode: "open",
    participantModeLabel: "全员开放",
    variantRule: "standard",
    variantRuleLabel: "标准卷",
    publishedAt: "2026-11-17T10:00:00Z",
    createdAt: "2026-11-17T09:00:00Z",
  },
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
  note: "",
  participantTagIds: [],
  participantUserIds: [],
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

describe("管理端监考大屏 · HTTP 模式", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    // 回声：把发出去的内容原样带回来，和真实后端一致。
    api.createProctorAction.mockImplementation(
      async (attemptId: string, input: { kind: string; reason: string }) => ({
        id: "1",
        attemptId,
        kind: input.kind,
        message: input.reason,
        reason: input.reason,
        operator: "陈砚之",
        createdAt: "2026-11-18T08:01:00Z",
      }),
    );
    api.loadAdminSession.mockResolvedValue(SESSION_DETAIL);
    api.loadSessionParticipants.mockResolvedValue([]);
    api.loadSessionGrades.mockResolvedValue([]);
    api.loadAdminSessions.mockResolvedValue([]);
    api.loadUserPage.mockResolvedValue({ items: [], total: 0 });
    api.loadRoles.mockResolvedValue([]);
    api.loadOrgTags.mockResolvedValue([]);

    // 监考快照走 httpClient（不经过 @exam/shared/api 出口），这里直接拦 fetch。
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/monitoring")) return json(MONITORING);
        throw new Error(`未预期的请求：${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/monitoring/12"]}>
        <Routes>
          <Route path="/monitoring/:sessionId" element={<ProctoringPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("考生状态来自服务端快照", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("林知遥")).toBeInTheDocument();
    });
    // 「作答中」在统计卡与状态徽标上各有一处。
    expect(screen.getAllByText("作答中").length).toBeGreaterThan(0);
    // 场次名与策略上限来自场次详情。
    expect(
      screen.getByRole("heading", { name: /计算机网络期中考试/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/上限 3 次/)).toBeInTheDocument();
  });

  it("处置按作答下发，带上 attemptId", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("林知遥")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "警告" }));
    await user.type(screen.getByLabelText("说明"), "联调验证：下发一次警告");
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(api.createProctorAction).toHaveBeenCalledTimes(1);
    });
    const [attemptId, payload] = api.createProctorAction.mock.calls[0]!;
    expect(attemptId).toBe("9001");
    expect(payload.kind).toBe("warn");
    expect(payload.reason).toBe("联调验证：下发一次警告");
  });

  it("本屏处置记录列出刚下发的处置", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("林知遥")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "备注" }));
    await user.type(screen.getByLabelText("说明"), "联调验证：加一条备注");
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(screen.getByText("本屏处置记录")).toBeInTheDocument();
    });
    // 处置记录一行里有原因、操作人与时间，按片段找。
    expect(screen.getByText(/联调验证：加一条备注/)).toBeInTheDocument();
  });
});
