/* ==========================================================================
   HTTP 模式的考试会话
   --------------------------------------------------------------------------
   打真实后端的那一支：卷面来自服务端，答案上行前要把显示字母换成原题键。

   换算错一次，梅花卷整卷判错——这里是它的守门用例：
   服务端给的选项顺序是 C/A/B（置换过），考生在卷面上看到的是 A/B/C，
   上行时必须发回原题键 C。
   ========================================================================== */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { useRemoteExamSession } from "../useRemoteExamSession";
import { useStudentStore } from "@/stores/studentStore";
import { useExamSessionStore } from "@/stores/examSessionStore";

/** 后端场次 ID。 */
const SESSION_ID = "3";
/** 后端作答会话 ID。 */
const ATTEMPT_ID = "9001";

/** 考试规则。 */
const RULES = {
  maxFocusLoss: 3,
  onMaxFocusLoss: "force_submit",
  requireFullScreen: false,
  blockCopyPaste: false,
  blockContextMenu: false,
  showWatermark: true,
  enableHeartbeatCheck: false,
  heartbeatIntervalSeconds: 30,
  heartbeatTimeoutSeconds: 90,
  maxDisconnect: 3,
  earlyEntryMinutes: 0,
};

/** 场次详情响应。 */
const SESSION_DETAIL = {
  session: {
    id: 3,
    name: "计算机网络期中考试",
    paperId: 5,
    paperName: "计算机网络期中试卷",
    status: "in_progress",
    statusLabel: "进行中",
    openAt: "2026-11-17T09:00:00Z",
    closeAt: "2026-11-17T12:00:00Z",
    durationMinutes: 60,
    participantMode: "open_to_all",
    participantModeLabel: "全员开放",
    variantRule: "small_plum",
    variantRuleLabel: "小梅花",
    publishedAt: "2026-11-16T10:00:00Z",
    createdAt: "2026-11-16T10:00:00Z",
  },
  snapshotId: 9,
  rules: RULES,
  note: "请在 60 分钟内完成作答。",
  participantTagIds: [],
  participantUserIds: [],
};

/** 作答会话响应：题目 11 的选项顺序是 C/A/B（服务端置换过）。 */
const ATTEMPT = {
  attemptId: ATTEMPT_ID,
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
  variantKey: "VP-abc123",
  rules: RULES,
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
  lastClientSeq: 0,
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

describe("useRemoteExamSession · HTTP 模式的考试会话", () => {
  /** 上行到服务端的答案批次。 */
  let uploads: Array<{
    items: Array<{ questionId: number; payload: { selectedOptionKeys?: string[] } }>;
  }> = [];

  beforeEach(() => {
    uploads = [];
    useStudentStore.getState().setStudentId("2023120101");
    useExamSessionStore.getState().resetAll();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/system/time")) {
          return json({ serverTime: "2026-11-17T10:00:00Z", monotonicTime: 1 });
        }
        if (url.includes(`/exam-sessions/${SESSION_ID}`)) return json(SESSION_DETAIL);
        if (url.endsWith("/attempts") && method === "POST") return json(ATTEMPT);
        if (url.includes(`/attempts/${ATTEMPT_ID}/answers`)) {
          uploads.push(JSON.parse(String(init?.body ?? "{}")));
          return json({
            acceptedClientSeq: 1,
            serverTime: "2026-11-17T10:00:00Z",
            remainingSeconds: 3500,
            rejected: [],
          });
        }
        if (url.includes(`/attempts/${ATTEMPT_ID}/submit`)) {
          return json({
            attemptId: ATTEMPT_ID,
            status: "submitted",
            statusLabel: "已交卷",
            submittedAt: "2026-11-17T10:30:00Z",
            submitReason: "manual",
            submitReasonLabel: "手动交卷",
            objectiveScore: 10,
            objectiveMax: 10,
            subjectivePending: false,
            totalScore: 10,
            totalMax: 10,
            gradeVisibility: "after_close",
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

  /** 渲染 HTTP 模式的考试会话。 */
  function renderSession() {
    return renderHook(() => useRemoteExamSession(SESSION_ID, true), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    });
  }

  it("卷面来自服务端：选项按服务端顺序排列，显示字母按位置重新编号", async () => {
    const { result } = renderSession();

    await waitFor(() => {
      expect(result.current.paper).not.toBeNull();
    });

    const item = result.current.paper!.items[0]!;
    // 服务端给的顺序是 C/A/B；显示字母按位置重编号。
    expect(item.displayKeys).toEqual(["C", "A", "B"]);
    expect(item.toOriginal).toEqual({ A: "C", B: "A", C: "B" });
    expect(result.current.exam?.name).toBe("计算机网络期中考试");
    expect(result.current.paper!.mode).toBe("small");
  });

  it("倒计时用服务端给的截止时间", async () => {
    const { result } = renderSession();

    await waitFor(() => {
      expect(result.current.paper).not.toBeNull();
    });

    // 服务端 remainingSeconds = 3600，本地倒计时从它起步。
    expect(result.current.remainingSec).toBeGreaterThan(3500);
    expect(result.current.remainingSec).toBeLessThanOrEqual(3600);
  });

  it("选中的显示字母在上行前换成原题键", async () => {
    const { result } = renderSession();

    await waitFor(() => {
      expect(result.current.paper).not.toBeNull();
    });

    // 考生在卷面上选的是显示字母 A。
    result.current.choose("11", ["A"]);

    // 上行有 3 秒防抖，等它发出。
    await waitFor(
      () => {
        expect(uploads.length).toBeGreaterThan(0);
      },
      { timeout: 10_000 },
    );

    const payload = uploads[0]!.items[0]!.payload;
    // 显示字母 A 对应原题键 C。
    expect(payload.selectedOptionKeys).toEqual(["C"]);
    expect(uploads[0]!.items[0]!.questionId).toBe(11);
  }, 20_000);

  it("交卷走服务端，成功后跳成绩报告", async () => {
    const { result } = renderSession();

    await waitFor(() => {
      expect(result.current.paper).not.toBeNull();
    });

    await userEvent.click(document.body);
    result.current.submit();

    await waitFor(() => {
      expect(result.current.submitted).toBe(true);
    });
  }, 20_000);
});
