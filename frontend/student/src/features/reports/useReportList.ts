/* ==========================================================================
   知行测评 · 成绩报告列表
   --------------------------------------------------------------------------
   两条数据通路各一份实现，页面只认 `ReportListRow`：

   - mock 模式：本地内容仓库里的成绩记录；
   - HTTP 模式：`GET /my/results`（只含已交卷的作答，强制交卷与超时自动交卷也算）。

   行 ID 是**跳转用的那一个**：考试用场次 ID（跳成绩报告），
   练习用开放单 ID（跳练习详情）——成绩条目里两者各有一个。
   ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import { isBackendEnabled, loadMyResults } from "@exam/shared/api";
import { useStudentRecords } from "@/features/shared/studentData";

/** 成绩列表的一行。 */
export interface ReportListRow {
  /** 记录类型。 */
  kind: "exam" | "practice";
  /** 考试：场次 ID；练习：开放单 ID。 */
  id: string;
  /** 名称。 */
  name: string;
  /** 日期（YYYY-MM-DD）。 */
  date: string;
  /** 得分。 */
  score: number;
  /** 满分。 */
  total: number;
  /** 主观题是否还在待阅。 */
  pending: boolean;
}

/** mock 模式的成绩列表。 */
export function useLocalReportList(enabled: boolean): ReportListRow[] {
  const records = useStudentRecords();
  return useMemo(() => {
    if (!enabled) return [];
    return records.map((record) => ({
      kind: record.kind,
      id: record.id,
      name: record.name,
      date: record.date,
      score: record.score,
      total: record.total,
      pending: record.pending,
    }));
  }, [records, enabled]);
}

/** HTTP 模式的成绩列表。 */
export function useRemoteReportList(enabled: boolean): {
  rows: ReportListRow[];
  loading: boolean;
} {
  const [rows, setRows] = useState<ReportListRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const results = await loadMyResults();
        if (cancelled) return;
        setRows(
          results.map((row) => ({
            kind: row.examSessionId ? "exam" : "practice",
            id: row.examSessionId ?? row.practiceAssignmentId ?? row.attemptId,
            name: row.examName ?? "—",
            date: (row.submittedAt ?? "").slice(0, 10) || "—",
            score: row.totalScore,
            total: row.totalMax,
            pending: row.subjectivePending,
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
  }, [enabled]);

  return { rows, loading };
}

/** 成绩列表（按数据源分派）。 */
export function useReportList(): { rows: ReportListRow[]; loading: boolean } {
  const remote = isBackendEnabled();
  const local = useLocalReportList(!remote);
  const remoteList = useRemoteReportList(remote);
  return remote ? remoteList : { rows: local, loading: false };
}
