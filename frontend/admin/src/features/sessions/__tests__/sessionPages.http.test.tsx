/* ==========================================================================
   管理端场次页面 · HTTP 模式渲染
   --------------------------------------------------------------------------
   断言的是**页面上真正能看到的东西**：场次名、卷型、名单人数、成绩、
   以及名单纳入方式的三种入口。
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/** 被测的 API 函数。 */
const api = {
  loadAdminSessions: vi.fn(),
  loadAdminSession: vi.fn(),
  loadSessionParticipants: vi.fn(),
  loadSessionGrades: vi.fn(),
  loadOrgTags: vi.fn(),
  loadUserPage: vi.fn(),
  publishAdminSession: vi.fn(),
  cancelAdminSession: vi.fn(),
  closeAdminSession: vi.fn(),
  createAdminSession: vi.fn(),
  updateAdminSession: vi.fn(),
  importExamParticipants: vi.fn(),
  loadSessionAssignments: vi.fn(),
  setSessionAssignments: vi.fn(),
};

vi.mock("@exam/shared/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBackendEnabled: () => true,
  ...api,
}));

const { ExamSessionListPage } = await import("../ExamSessionListPage");
const { ExamSessionDetailPage } = await import("../ExamSessionDetailPage");

/** 后端场次摘要。 */
const SUMMARY = {
  id: "12",
  name: "计算机网络期中考试 · 第 2 场",
  paperId: "3",
  paperName: "计算机网络期中试卷",
  status: "in_progress",
  statusLabel: "进行中",
  openAt: "2026-11-20T00:30:00Z",
  closeAt: "2026-11-20T04:00:00Z",
  durationMinutes: 90,
  participantMode: "tags",
  participantModeLabel: "按组织标签",
  variantRule: "small_plum",
  variantRuleLabel: "小梅花",
  publishedAt: "2026-11-19T10:00:00Z",
  createdAt: "2026-11-18T10:00:00Z",
};

describe("管理端场次页面 · HTTP 模式", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.loadAdminSessions.mockResolvedValue([SUMMARY]);
    api.loadAdminSession.mockResolvedValue({
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
      participantTagIds: ["5"],
      participantUserIds: [],
    });
    api.loadSessionParticipants.mockResolvedValue([
      {
        userId: "101",
        username: "s101",
        displayName: "林知遥",
        status: "invited",
        statusLabel: "待入场",
        attemptsUsed: 0,
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
        submittedAt: "2026-11-20T02:00:00Z",
      },
    ]);
    api.loadOrgTags.mockResolvedValue([
      { id: "5", code: "cs-2024", name: "计算机 2024 级", parentId: null },
    ]);
    api.loadUserPage.mockResolvedValue({
      items: [
        { id: "101", username: "s101", displayName: "林知遥", status: "active", roles: ["student"] },
      ],
      total: 1,
    });
    api.loadSessionAssignments.mockResolvedValue([]);
    api.setSessionAssignments.mockResolvedValue([]);
  });

  it("列表页显示后端场次与名单纳入方式", async () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="*" element={<ExamSessionListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(SUMMARY.name)).toBeInTheDocument();
    });
    // 名单列显示的是「名单纳入方式」，不是人数。
    expect(screen.getAllByText("按组织标签").length).toBeGreaterThan(0);
    expect(screen.getAllByText("进行中").length).toBeGreaterThan(0);
    // 列表接口不提供名单人数：不能编一个数出来。
    expect(screen.queryByText(/^\d+ 人$/)).not.toBeInTheDocument();
  });

  it("新建场次的名单入口按后端口径分成三种", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Routes>
          <Route path="*" element={<ExamSessionListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /新建场次/ }));

    expect(screen.getByRole("button", { name: "按组织标签" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "指定考生" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全员开放" })).toBeInTheDocument();

    // 组织标签来自后端，不是写死的班级。
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "计算机 2024 级" })).toBeInTheDocument();
    });
    // 补考是试卷的属性：HTTP 模式下场次不再单独设置。
    expect(screen.getByText(/是否允许重考由/)).toBeInTheDocument();
  });

  it("名单 CSV 导入走服务端的导入端点", async () => {
    const user = userEvent.setup();
    api.loadAdminSession.mockResolvedValue({
      summary: { ...SUMMARY, status: "scheduled", statusLabel: "未开始" },
      snapshotId: null,
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
      participantTagIds: [],
      participantUserIds: [],
    });
    api.importExamParticipants.mockResolvedValue({
      total: 3,
      imported: 2,
      skipped: [{ rowNumber: 3, account: "s103", reason: "账号不存在：s103。先在「用户」里建好账号再导入。" }],
      participantCount: 2,
      participantMode: "direct",
      participantModeLabel: "指定考生",
    });

    render(
      <MemoryRouter initialEntries={["/exam-sessions/12"]}>
        <Routes>
          <Route path="/exam-sessions/:id" element={<ExamSessionDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "导入名单" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "导入名单" }));
    const file = new File(["账号,姓名\ns101,林知遥\n"], "roster.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText(/名单文件/), file);
    await user.click(screen.getByRole("button", { name: "确认导入" }));

    await waitFor(() => {
      expect(api.importExamParticipants).toHaveBeenCalledTimes(1);
    });
    expect(api.importExamParticipants.mock.calls[0]![0]).toBe("12");

    // 结果与被跳过的行都给管理员看。
    expect(await screen.findByText(/导入完成：成功 2 人，跳过 1 行/)).toBeInTheDocument();
    expect(screen.getByText(/账号不存在：s103/)).toBeInTheDocument();
  });

  it("详情页能指派负责教师", async () => {
    const user = userEvent.setup();
    api.loadSessionAssignments.mockResolvedValue([
      {
        userId: "201",
        username: "t201",
        displayName: "周慕青",
        assignedAt: "2026-11-19T10:00:00Z",
      },
    ]);
    api.loadUserPage.mockResolvedValue({
      items: [
        { id: "101", username: "s101", displayName: "林知遥", status: "active", roles: ["student"] },
        {
          id: "201",
          username: "t201",
          displayName: "周慕青",
          status: "active",
          roles: ["grader_teacher"],
        },
      ],
      total: 2,
    });
    api.setSessionAssignments.mockResolvedValue([
      {
        userId: "201",
        username: "t201",
        displayName: "周慕青",
        assignedAt: "2026-11-19T10:00:00Z",
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/exam-sessions/12"]}>
        <Routes>
          <Route path="/exam-sessions/:id" element={<ExamSessionDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "负责教师" })).toBeInTheDocument();
    });
    // 已指派的负责人显示出来。
    expect(screen.getByText(/周慕青/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "指派教师" }));

    // 候选里只有教师：学生不是负责人候选。
    const candidate = await screen.findByRole("checkbox", { name: /周慕青/ });
    expect(candidate).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: /林知遥/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存指派" }));

    await waitFor(() => {
      expect(api.setSessionAssignments).toHaveBeenCalledTimes(1);
    });
    // 覆盖式保存：传的是整份指派名单。
    expect(api.setSessionAssignments.mock.calls[0]).toEqual(["12", ["201"]]);
  });

  it("详情页显示场次配置、名单与成绩", async () => {
    render(
      <MemoryRouter initialEntries={["/exam-sessions/12"]}>
        <Routes>
          <Route path="/exam-sessions/:id" element={<ExamSessionDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: SUMMARY.name })).toBeInTheDocument();
    });

    expect(screen.getByText("计算机网络期中试卷")).toBeInTheDocument();
    expect(screen.getByText("小梅花")).toBeInTheDocument();
    expect(screen.getByText("开考后不要切屏")).toBeInTheDocument();
    // 名单里的人与成绩都在。
    expect(screen.getByText("林知遥")).toBeInTheDocument();
    expect(screen.getByText("8 / 10")).toBeInTheDocument();
    // 场次进行中：给的是「结束考试」而不是「发布场次」。
    expect(screen.getByRole("button", { name: "结束考试" })).toBeInTheDocument();
  });
});
