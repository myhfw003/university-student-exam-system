/* ==========================================================================
   知行测评 · 学生端考试安排列表
   --------------------------------------------------------------------------
   两条数据通路各有一份实现，但页面只认 `ExamListRow` 这一种行：

   - mock 模式：本地内容仓库里的试卷 + 作答记录；
   - HTTP 模式：`GET /exam-sessions`（场次）+ `GET /attempts`（我的作答），
     试卷的标签与总分从内容目录里取（目录在 HTTP 模式下已按后端读回）。

   可见性判定都在后端：这里拿到的就是能看的全部。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@exam/shared";
import {
  isBackendEnabled,
  listMyAttempts,
  loadMyExamSessions,
  toPaperMode,
  type ExamSessionSummary,
} from "@exam/shared/api";
import type { AttemptSummary } from "@exam/shared/domain/attempt";
import { useCatalog } from "@exam/shared/mock/catalog";
import type { PaperMode } from "@exam/shared/domain/types";
import { formatDateTime } from "@exam/shared";
import { useStudentStore } from "@/stores/studentStore";
import { useExamSessionStore } from "@/stores/examSessionStore";
import { useVisibleExams } from "@/features/shared/studentData";

/** 考试安排的一行。 */
export interface ExamListRow {
  /** 场次 ID（HTTP 模式）或试卷 ID（mock 模式）。 */
  id: string;
  /** 考试名称。 */
  name: string;
  /** 副标题：批次（mock）或试卷名（HTTP）。 */
  subtitle: string;
  /** 标签 ID。 */
  tags: string[];
  /** 时长（分钟）。 */
  durationMin: number;
  /** 目标总分。 */
  totalScore: number;
  /** 卷型。 */
  mode: PaperMode;
  /** 开放时间。 */
  openAt: string;
  /** 是否已交卷。 */
  submitted: boolean;
  /** 交卷时间。 */
  submittedAt: string | null;
  /** 是否允许重考。 */
  allowRetake: boolean;
  /** 考试是否已结束。 */
  ended: boolean;
}

/** 会话是否已结束。 */
function isFinished(status: string): boolean {
  return (
    status === "submitted" ||
    status === "auto_submitted" ||
    status === "force_submitted" ||
    status === "abandoned"
  );
}

/** mock 模式的考试安排列表。 */
export function useLocalExamList(enabled: boolean): ExamListRow[] {
  const studentId = useStudentStore((state) => state.studentId);
  const exams = useVisibleExams();
  const attempts = useCatalog((state) => state.attempts);

  return useMemo(() => {
    if (!enabled) return [];
    return exams.map((exam) => {
      const attempt = Object.values(attempts).find(
        (a) => a.examId === exam.id && a.studentId === studentId,
      );
      return {
        id: exam.id,
        name: exam.name,
        subtitle: exam.batch || "",
        tags: exam.tags,
        durationMin: exam.durationMin,
        totalScore: exam.totalScore,
        mode: exam.plum.mode,
        openAt: exam.openAt,
        submitted: Boolean(attempt),
        submittedAt: attempt?.submittedAt ?? null,
        allowRetake: exam.allowRetake,
        ended: exam.status === "ended",
      };
    });
  }, [enabled, exams, attempts, studentId]);
}

/** HTTP 模式的考试安排列表。 */
export function useRemoteExamList(enabled: boolean): {
  rows: ExamListRow[];
  loading: boolean;
} {
  const [sessions, setSessions] = useState<ExamSessionSummary[]>([]);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [loading, setLoading] = useState(false);
  // 内容目录里的试卷：标签、总分、卷型、重考许可都在这里。
  const papers = useCatalog((state) => state.exams);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const [loadedSessions, loadedAttempts] = await Promise.all([
          loadMyExamSessions(),
          listMyAttempts().catch(() => [] as AttemptSummary[]),
        ]);
        if (cancelled) return;
        setSessions(loadedSessions);
        setAttempts(loadedAttempts);
      } catch {
        // 读不到场次：列表保持为空，页面给出空状态。
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const rows = useMemo<ExamListRow[]>(() => {
    if (!enabled) return [];
    return sessions.map((session) => {
      const paper = papers.find((p) => p.id === session.paperId);
      const attempt = attempts.find((a) => a.examSessionId === session.id);
      return {
        id: session.id,
        name: session.name,
        subtitle: session.paperName,
        tags: paper?.tags ?? [],
        durationMin: session.durationMinutes,
        totalScore: paper?.totalScore ?? 0,
        mode: paper?.plum.mode ?? toPaperMode(session.variantRule),
        openAt: formatDateTime(session.openAt),
        submitted: attempt ? isFinished(attempt.status) : false,
        submittedAt: attempt?.submittedAt ?? null,
        allowRetake: paper?.allowRetake ?? false,
        ended: session.status === "closed" || session.status === "cancelled",
      };
    });
  }, [enabled, sessions, attempts, papers]);

  return { rows, loading };
}

/** 考试安排列表（按数据源分派）。 */
export function useExamList(): { rows: ExamListRow[]; loading: boolean } {
  const remote = isBackendEnabled();
  const local = useLocalExamList(!remote);
  const remoteList = useRemoteExamList(remote);
  return remote ? remoteList : { rows: local, loading: false };
}

/**
 * 再考一次。
 *
 * mock 模式要先把本地会话清零，否则重新进入会命中「已交卷」的死路；
 * HTTP 模式由服务端开出新的一次作答（不允许重考时服务端会拒绝），
 * 本地什么都不用做。
 */
export function useRetakeExam(): (row: ExamListRow) => void {
  const navigate = useNavigate();
  const studentId = useStudentStore((state) => state.studentId);
  const remote = isBackendEnabled();

  return useCallback(
    (row: ExamListRow) => {
      if (!remote) {
        useExamSessionStore.getState().resetForRetake({
          examId: row.id,
          studentId,
          durationMin: row.durationMin,
        });
        toast.ok("已开启重考，成绩按最高分计入");
      }
      navigate(`/exams/${row.id}`);
    },
    [remote, navigate, studentId],
  );
}
