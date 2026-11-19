/* ==========================================================================
   知行测评 · 管理端成绩分析的数据通路
   --------------------------------------------------------------------------
   真实后端的成绩分析按**场次**给：一场考试一份统计（分数段、题型得分率、
   逐题正确率、逐人明细）。前端不重算——两边各算一套，同一场考试会给出两个
   不同的分布。

   mock 模式没有场次统计：页面的原型口径是「用固定种子模拟答卷」，
   那条路径留在页面里，HTTP 模式走这里。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isBackendEnabled,
  loadAdminSessions,
  loadExamSessionStatistics,
  type ExamSessionStatistics,
} from "@exam/shared/api";
import { SESSION_STATUS_LABEL, useAdminOps } from "@exam/shared/mock/adminOps";

/** 可分析的场次。 */
export interface AnalyticsSession {
  id: string;
  name: string;
  /** 来源试卷 ID（预览答题者卷面时要用）。 */
  paperId: string;
  status: string;
  statusLabel: string;
}

/** 成绩分析的数据通路。 */
export function useAdminAnalytics(): {
  /** 是否走真实后端。 */
  remote: boolean;
  /** 可分析的场次。 */
  sessions: AnalyticsSession[];
  /** 当前场次的统计（HTTP 模式）。 */
  statistics: ExamSessionStatistics | null;
  /** 当前场次 ID。 */
  sessionId: string;
  setSessionId: (id: string) => void;
  loading: boolean;
  refresh: () => void;
} {
  const remote = isBackendEnabled();
  const mockSessions = useAdminOps((state) => state.sessions);

  const [sessions, setSessions] = useState<AnalyticsSession[]>([]);
  const [statistics, setStatistics] = useState<ExamSessionStatistics | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  // 场次清单。
  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await loadAdminSessions({ status: "", keyword: "" });
        if (cancelled) return;
        // 只有**发布过的**场次才有成绩统计（服务端按快照算）。
        const rows = list
          .filter((session) => session.publishedAt)
          .map((session) => ({
            id: session.id,
            name: session.name,
            paperId: session.paperId,
            status: session.status,
            statusLabel: session.statusLabel,
          }));
        setSessions(rows);
        // 默认选第一场。
        setSessionId((prev) => prev || rows[0]?.id || "");
      } catch {
        if (!cancelled) setSessions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, token]);

  // 当前场次的统计。
  useEffect(() => {
    if (!remote || !sessionId) {
      setStatistics(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const result = await loadExamSessionStatistics(sessionId);
        if (!cancelled) setStatistics(result);
      } catch {
        if (!cancelled) setStatistics(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, sessionId, token]);

  const mockSessions2 = useMemo<AnalyticsSession[]>(
    () =>
      mockSessions.map((session) => ({
        id: session.id,
        name: session.name,
        paperId: session.paperId,
        status: session.status,
        statusLabel: SESSION_STATUS_LABEL[session.status] ?? session.status,
      })),
    [mockSessions],
  );

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  return {
    remote,
    sessions: remote ? sessions : mockSessions2,
    statistics: remote ? statistics : null,
    sessionId,
    setSessionId,
    loading,
    refresh,
  };
}
