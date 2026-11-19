/* ==========================================================================
   知行测评 · 管理端场次数据通路
   --------------------------------------------------------------------------
   场次列表与详情各有一份 mock / HTTP 实现，页面只认这里定义的形状。

   两处口径差异要注意（页面不知道，数据通路知道）：

   1. **状态流转**：mock 有「推进状态」这一步，真实后端没有——
      后端是「发布即进行中」，再由「关闭 / 取消」收尾。
   2. **名单**：mock 的名单是班级 ID 展开出来的，
      真实后端是**组织维度标签**（院系 → 专业 → 班级）在发布时物化成的考生列表。
   3. **防作弊策略**：mock 叫 `AntiCheatPolicy`，后端叫考试规则（`rules`），
      字段一一对应，转换在这里做。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelAdminSession,
  closeAdminSession,
  createAdminSession,
  isBackendEnabled,
  loadAdminSession,
  importExamParticipants,
  loadAdminSessions,
  loadSessionAssignments,
  loadSessionGrades,
  loadSessionParticipants,
  publishAdminSession,
  publishSessionGrades,
  setSessionAssignments,
  updateAdminSession,
  type AdminSessionCreate,
  type ExamParticipantImportResult,
  type GradePublication,
} from "@exam/shared/api";
import type {
  AdminSessionRules,
  AdminSessionSummary,
  SessionAssignment,
} from "@exam/shared/domain/admin";
import type { AntiCheatPolicy, ExamSessionStatus, PaperMode } from "@exam/shared/domain/types";
import {
  advanceSession,
  cancelSession,
  getSession,
  updateSession,
  useAdminOps,
} from "@exam/shared/mock/adminOps";
import { getExam, useCatalog } from "@exam/shared/mock/catalog";

/** 场次列表的一行。 */
export interface AdminSessionRow {
  id: string;
  name: string;
  /** 来源试卷 ID。 */
  paperId: string;
  /** 来源试卷名。 */
  paperName: string;
  status: ExamSessionStatus;
  statusLabel: string;
  openAt: string;
  closeAt: string;
  /** 作答时长（分钟）。 */
  durationMin: number;
  /** 名单人数；真实后端的列表接口不提供，用 null 表示「未知」。 */
  rosterCount: number | null;
  /** 名单纳入方式的中文名。 */
  rosterModeLabel: string;
}

/** 名单里的一人。 */
export interface RosterEntry {
  /** 考生 ID。 */
  userId: string;
  /** 显示名。 */
  displayName: string;
  /** 名单组（mock 有；真实后端的名单不带组织路径）。 */
  className: string;
}

/** 成绩行（导出 CSV 用）。 */
export interface SessionGradeRow {
  userId: string;
  username: string;
  displayName: string;
  score: number | null;
  total: number | null;
  submittedAt: string | null;
}

/** 场次详情的统一视图。 */
export interface AdminSessionDetailView {
  /** 场次不存在。 */
  missing: boolean;
  /** 场次 ID。 */
  id: string;
  name: string;
  status: ExamSessionStatus;
  statusLabel: string;
  paperId: string;
  paperName: string;
  openAt: string;
  closeAt: string;
  durationMin: number;
  /** 是否允许重考（**试卷的属性**）。 */
  allowRetake: boolean;
  /** 卷型。 */
  mode: PaperMode;
  /** 名单来源描述。 */
  rosterSource: string;
  /** 考生须知。 */
  note: string;
  /** 防作弊策略（前端口径）。 */
  policy: AntiCheatPolicy;
  /** 名单。 */
  roster: RosterEntry[];
  /** 成绩行。 */
  grades: SessionGradeRow[];
  loading: boolean;
  /** 发布场次（名单在此刻物化）。 */
  publish: () => Promise<void>;
  /** 关闭场次。 */
  close: () => Promise<void>;
  /** 取消场次。 */
  cancel: () => Promise<void>;
  /** 保存防作弊策略。 */
  savePolicy: (patch: Partial<AntiCheatPolicy>) => Promise<void>;
  /** 名单 CSV 导入（真实后端模式；导入后口径切到「指定考生」）。 */
  importParticipants: (file: File) => Promise<ExamParticipantImportResult>;
  /** 场次负责人（阅卷教师 / 监考人员）。 */
  assignments: SessionAssignment[];
  /** 保存场次负责人（覆盖式）。 */
  saveAssignments: (userIds: string[]) => Promise<void>;
  /** 发布成绩（全部成绩 / 仅客观题）。 */
  publishGrades: (scope: "all" | "objective_only") => Promise<GradePublication>;
  /** 重新拉取。 */
  refresh: () => void;
}

/** 后端卷型规则 → 前端卷型。 */
function toPaperMode(rule: string): PaperMode {
  if (rule === "small_plum") return "small";
  if (rule === "large_plum") return "large";
  return "standard";
}

/** 后端考试规则 → 前端防作弊策略。 */
function toPolicy(rules: AdminSessionRules): AntiCheatPolicy {
  return {
    maxFocusLoss: rules.maxFocusLoss ?? 0,
    onExceeded: rules.onMaxFocusLoss === "warn" ? "warn" : "force_submit",
    requireFullscreen: rules.requireFullScreen,
    disableCopyPaste: rules.blockCopyPaste,
    disableContextMenu: rules.blockContextMenu,
    watermark: rules.showWatermark,
    heartbeatIntervalSec: rules.heartbeatIntervalSeconds,
    disconnectThresholdSec: rules.heartbeatTimeoutSeconds,
  };
}

/** 前端防作弊策略 → 后端考试规则。 */
function toRules(policy: AntiCheatPolicy): AdminSessionRules {
  return {
    maxFocusLoss: policy.maxFocusLoss,
    onMaxFocusLoss: policy.onExceeded,
    requireFullScreen: policy.requireFullscreen,
    blockCopyPaste: policy.disableCopyPaste,
    blockContextMenu: policy.disableContextMenu,
    showWatermark: policy.watermark,
    enableHeartbeatCheck: true,
    heartbeatIntervalSeconds: policy.heartbeatIntervalSec,
    heartbeatTimeoutSeconds: policy.disconnectThresholdSec,
    maxDisconnect: 3,
    earlyEntryMinutes: 0,
  };
}

/** 名单纳入方式 → 中文名（后端存储值：`tags` / `direct` / `open`）。 */
function rosterModeLabel(mode: string): string {
  if (mode === "tags") return "按组织标签";
  if (mode === "direct") return "指定考生";
  if (mode === "open") return "全员开放";
  return "";
}

/* ------------------------------------------------------------ 场次列表 */

/**
 * 场次列表。
 *
 * mock 模式在前端过滤；HTTP 模式把状态与关键词交给服务端过滤
 * （场次可能有几百场，前端不该全拉回来自己筛）。
 */
export function useAdminSessionList(filter: {
  status: string;
  keyword: string;
}): { rows: AdminSessionRow[]; loading: boolean; refresh: () => void } {
  const remote = isBackendEnabled();
  const mockSessions = useAdminOps((state) => state.sessions);

  const [rows, setRows] = useState<AdminSessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const sessions = await loadAdminSessions({
          status: filter.status,
          keyword: filter.keyword,
        });
        if (cancelled) return;
        setRows(
          sessions.map((session) => ({
            id: session.id,
            name: session.name,
            paperId: session.paperId,
            paperName: session.paperName,
            status: session.status,
            statusLabel: session.statusLabel,
            openAt: session.openAt,
            closeAt: session.closeAt,
            durationMin: session.durationMinutes,
            // 列表接口不返回名单人数：逐场次去数会把请求数乘上场次数。
            rosterCount: null,
            rosterModeLabel: session.participantModeLabel || rosterModeLabel(session.participantMode),
          })),
        );
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [remote, filter.status, filter.keyword, token]);

  const mockRows = useMemo<AdminSessionRow[]>(() => {
    if (remote) return [];
    const keyword = filter.keyword.trim().toLowerCase();
    return mockSessions
      .filter((session) => {
        if (filter.status !== "all" && session.status !== filter.status) return false;
        if (keyword && !`${session.name} ${session.id}`.toLowerCase().includes(keyword)) return false;
        return true;
      })
      .map((session) => ({
        id: session.id,
        name: session.name,
        paperId: session.paperId,
        paperName: getExam(session.paperId)?.name ?? session.paperId,
        status: session.status,
        statusLabel: "",
        openAt: session.openAt,
        closeAt: session.closeAt,
        durationMin: session.durationMin,
        rosterCount: session.roster.length,
        rosterModeLabel:
          session.directUserIds && session.directUserIds.length > 0
            ? "指定考生"
            : session.scope.length === 0
              ? "全员开放"
              : "按组织标签",
      }));
  }, [remote, mockSessions, filter.status, filter.keyword]);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  return { rows: remote ? rows : mockRows, loading, refresh };
}

/* ------------------------------------------------------------ 场次详情 */

/**
 * 场次详情。
 *
 * 返回统一的视图形状：mock 模式读本地内容仓库，HTTP 模式读真实后端。
 */
export function useAdminSessionDetail(id: string): AdminSessionDetailView {
  const remote = isBackendEnabled();
  const mockSessions = useAdminOps((state) => state.sessions);
  const students = useCatalog((state) => state.students);
  const attempts = useCatalog((state) => state.attempts);
  const records = useCatalog((state) => state.records);
  const papers = useCatalog((state) => state.exams);

  const [remoteDetail, setRemoteDetail] = useState<{
    summary: AdminSessionSummary;
    rules: AdminSessionRules;
    note: string;
    participantTagIds: string[];
    participantUserIds: string[];
  } | null>(null);
  const [participants, setParticipants] = useState<
    { userId: string; displayName: string; className: string }[]
  >([]);
  const [grades, setGrades] = useState<SessionGradeRow[]>([]);
  const [assignments, setAssignments] = useState<SessionAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote || !id) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const detail = await loadAdminSession(id);
        const [roster, gradeRows, assignees] = await Promise.all([
          loadSessionParticipants(id),
          loadSessionGrades(id).catch(() => []),
          loadSessionAssignments(id).catch(() => []),
        ]);
        if (cancelled) return;
        setRemoteDetail(detail);
        setAssignments(assignees);
        setParticipants(
          roster.map((participant) => ({
            userId: participant.userId,
            displayName: participant.displayName || participant.username,
            className: "",
          })),
        );
        setGrades(
          gradeRows.map((grade) => ({
            userId: grade.userId,
            username: grade.studentUsername,
            displayName: grade.studentDisplayName,
            score: grade.totalScore,
            total: grade.totalMax,
            submittedAt: grade.submittedAt,
          })),
        );
      } catch {
        if (!cancelled) setRemoteDetail(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [remote, id, token]);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  /* ---------------------------------------------------------- mock 视图 */

  const mockSession = useMemo(
    () => mockSessions.find((session) => session.id === id),
    [mockSessions, id],
  );

  const mockRoster = useMemo<RosterEntry[]>(() => {
    if (remote || !mockSession) return [];
    return mockSession.roster.map((studentId) => {
      const student = students.find((s) => s.id === studentId);
      return {
        userId: studentId,
        displayName: student?.name ?? studentId,
        className: student?.classId ?? "",
      };
    });
  }, [remote, mockSession, students]);

  const mockGrades = useMemo<SessionGradeRow[]>(() => {
    if (remote || !mockSession) return [];
    return mockSession.roster.map((studentId) => {
      const student = students.find((s) => s.id === studentId);
      const attempt = Object.values(attempts).find(
        (a) => a.examId === mockSession.paperId && a.studentId === studentId,
      );
      const record = records.find(
        (r) => r.examId === mockSession.paperId && r.studentId === studentId,
      );
      return {
        userId: studentId,
        username: studentId,
        displayName: student?.name ?? studentId,
        score: attempt?.score ?? record?.score ?? null,
        total: attempt?.total ?? record?.total ?? null,
        submittedAt: attempt?.submittedAt ?? record?.date ?? null,
      };
    });
  }, [remote, mockSession, students, attempts, records]);

  /* ---------------------------------------------------------- 动作 */

  const publish = useCallback(async () => {
    if (!remote) {
      const session = getSession(id);
      if (!session) return;
      const result = advanceSession(id);
      if (!result.ok) throw new Error(result.message ?? "发布失败");
      refresh();
      return;
    }
    await publishAdminSession(id);
    refresh();
  }, [remote, id, refresh]);

  const close = useCallback(async () => {
    if (!remote) {
      const result = advanceSession(id);
      if (!result.ok) throw new Error(result.message ?? "关闭失败");
      refresh();
      return;
    }
    await closeAdminSession(id);
    refresh();
  }, [remote, id, refresh]);

  const cancel = useCallback(async () => {
    if (!remote) {
      const result = cancelSession(id, "管理员取消");
      if (!result.ok) throw new Error(result.message ?? "取消失败");
      refresh();
      return;
    }
    await cancelAdminSession(id);
    refresh();
  }, [remote, id, refresh]);

  const savePolicy = useCallback(
    async (patch: Partial<AntiCheatPolicy>) => {
      if (!remote) {
        const session = getSession(id);
        if (!session) return;
        const result = updateSession(id, { policy: { ...session.policy, ...patch } });
        if (!result.ok) throw new Error(result.message ?? "保存失败");
        refresh();
        return;
      }

      const detail = remoteDetail;
      if (!detail) return;
      const current = toPolicy(detail.rules);
      await updateAdminSession(id, {
        name: detail.summary.name,
        openAt: detail.summary.openAt,
        closeAt: detail.summary.closeAt,
        durationMinutes: detail.summary.durationMinutes,
        participantMode: detail.summary.participantMode,
        participantTagIds: detail.participantTagIds,
        participantUserIds: detail.participantUserIds,
        variantRule: detail.summary.variantRule,
        rules: toRules({ ...current, ...patch }),
        note: detail.note,
      });
      refresh();
    },
    [remote, id, remoteDetail, refresh],
  );

  /** 名单 CSV 导入。mock 模式没有这个能力（名单是本地数据）。 */
  const importParticipants = useCallback(
    async (file: File) => {
      if (!remote) {
        throw new Error("名单导入只在真实后端模式下可用。");
      }
      const result = await importExamParticipants(id, file);
      refresh();
      return result;
    },
    [remote, id, refresh],
  );

  /**
   * 保存场次负责人（覆盖式）。
   *
   * 指派只界定「谁负责这场考试」，不授予权限——被指派的人仍要有对应的权限点。
   * mock 模式没有这个模型（本地内容仓库里没有指派关系）。
   */
  const saveAssignments = useCallback(
    async (userIds: string[]) => {
      if (!remote) {
        throw new Error("场次负责人指派只在真实后端模式下可用。");
      }
      const saved = await setSessionAssignments(id, userIds);
      setAssignments(saved);
      refresh();
    },
    [remote, id, refresh],
  );

  /**
   * 发布场次成绩。
   *
   * 范围两种：全部成绩、仅客观题（主观题还没阅完时先公布客观分）。
   * mock 模式没有「成绩发布」这个模型（本地内容仓库里没有发布记录）。
   */
  const publishGrades = useCallback(
    async (scope: "all" | "objective_only"): Promise<GradePublication> => {
      if (!remote) {
        throw new Error("成绩发布只在真实后端模式下可用。");
      }
      const published = await publishSessionGrades(id, scope);
      refresh();
      return published;
    },
    [remote, id, refresh],
  );

  /* ---------------------------------------------------------- 视图 */

  if (remote) {
    if (!remoteDetail) {
      return {
        missing: true,
        id: "",
        name: "",
        status: "scheduled",
        statusLabel: "",
        paperId: "",
        paperName: "",
        openAt: "",
        closeAt: "",
        durationMin: 0,
        allowRetake: false,
        mode: "standard",
        rosterSource: "",
        note: "",
        policy: {
          maxFocusLoss: 0,
          onExceeded: "force_submit",
          requireFullscreen: false,
          disableCopyPaste: false,
          disableContextMenu: false,
          watermark: false,
          heartbeatIntervalSec: 30,
          disconnectThresholdSec: 90,
        },
        roster: [],
        grades: [],
        loading,
        publish,
        close,
        cancel,
        savePolicy,
        importParticipants,
        assignments,
        saveAssignments,
        publishGrades,
        refresh,
      };
    }

    const summary = remoteDetail.summary;
    const paper = papers.find((p) => p.id === summary.paperId);

    return {
      missing: false,
      id: summary.id,
      name: summary.name,
      status: summary.status,
      statusLabel: summary.statusLabel,
      paperId: summary.paperId,
      paperName: summary.paperName || paper?.name || summary.paperId,
      openAt: summary.openAt,
      closeAt: summary.closeAt,
      durationMin: summary.durationMinutes,
      // 允许重考是**试卷**的属性，不是场次的。
      allowRetake: paper?.allowRetake ?? false,
      mode: toPaperMode(summary.variantRule),
      rosterSource:
        summary.participantMode === "tags"
          ? `按组织标签（${remoteDetail.participantTagIds.length} 个标签）`
          : summary.participantMode === "direct"
            ? `指定考生（${remoteDetail.participantUserIds.length} 人）`
            : "全员开放",
      note: remoteDetail.note,
      policy: toPolicy(remoteDetail.rules),
      roster: participants,
      grades,
      loading,
      publish,
      close,
      cancel,
      savePolicy,
      importParticipants,
      assignments,
      saveAssignments,
      publishGrades,
      refresh,
    };
  }

  const session = mockSession;
  if (!session) {
    return {
      missing: true,
      id: "",
      name: "",
      status: "scheduled",
      statusLabel: "",
      paperId: "",
      paperName: "",
      openAt: "",
      closeAt: "",
      durationMin: 0,
      allowRetake: false,
      mode: "standard",
      rosterSource: "",
      note: "",
      policy: {
        maxFocusLoss: 0,
        onExceeded: "force_submit",
        requireFullscreen: false,
        disableCopyPaste: false,
        disableContextMenu: false,
        watermark: false,
        heartbeatIntervalSec: 30,
        disconnectThresholdSec: 90,
      },
      roster: [],
      grades: [],
      loading,
      publish,
      close,
      cancel,
      savePolicy,
      importParticipants,
      assignments,
      saveAssignments,
      publishGrades,
      refresh,
    };
  }

  const paper = getExam(session.paperId);

  return {
    missing: false,
    id: session.id,
    name: session.name,
    status: session.status,
    statusLabel: "",
    paperId: session.paperId,
    paperName: paper?.name ?? session.paperId,
    openAt: session.openAt,
    closeAt: session.closeAt,
    durationMin: session.durationMin,
    allowRetake: session.allowRetake,
    mode: paper?.plum.mode ?? "standard",
    rosterSource:
      session.directUserIds && session.directUserIds.length > 0
        ? `指定考生（${session.directUserIds.length} 人）`
        : session.scope.length === 0
          ? "全员开放"
          : `按名单组（${session.scope.length} 组）`,
    note: session.note,
    policy: session.policy,
    roster: mockRoster,
    grades: mockGrades,
    loading,
    publish,
    close,
    cancel,
    savePolicy,
    importParticipants,
    assignments: [],
    saveAssignments,
    publishGrades,
    refresh,
  };
}

/** 新建场次（HTTP 模式）。 */
export async function submitAdminSession(
  input: AdminSessionCreate,
): Promise<{ ok: boolean; message?: string }> {
  try {
    await createAdminSession(input);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "创建失败" };
  }
}
