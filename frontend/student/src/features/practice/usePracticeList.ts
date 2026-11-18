/* ==========================================================================
   知行测评 · 学生端练习中心列表
   --------------------------------------------------------------------------
   两条数据通路各一份实现，页面只认 `PracticeListRow`：

   - mock 模式：本地内容仓库里的练习与成绩记录；
   - HTTP 模式：`GET /practices`（学生可见的开放单）+ `GET /my/results`（已做过的成绩）。

   可见性判定都在后端：这里拿到的就是能看的全部。
   ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import { isBackendEnabled, loadMyPractices, loadMyResults } from "@exam/shared/api";
import { useCatalog } from "@exam/shared/mock/catalog";
import { useStudentStore } from "@/stores/studentStore";
import { useStudentRecords, useVisiblePractices } from "@/features/shared/studentData";

/** 练习中心的一行。 */
export interface PracticeListRow {
  /** 开放单 ID（mock 模式是练习 ID）。 */
  id: string;
  /** 标题。 */
  name: string;
  /** 题量。 */
  questionCount: number;
  /** 预计用时（分钟）。 */
  durationMin: number;
  /** 总分。 */
  totalScore: number;
  /** 标签 ID。 */
  tags: string[];
  /** 已做过的成绩；没做过为 null。 */
  result: { score: number; total: number } | null;
  /** 现在能不能开始。 */
  canStart: boolean;
  /** 剩余次数；null = 不限。 */
  remainingAttempts: number | null;
}

/** mock 模式的练习列表。 */
export function useLocalPracticeList(enabled: boolean): PracticeListRow[] {
  const practices = useVisiblePractices();
  const records = useStudentRecords();
  const practiceResults = useCatalog((state) => state.practiceResults);
  const studentId = useStudentStore((state) => state.studentId);

  return useMemo(() => {
    if (!enabled) return [];
    return practices.map((practice) => {
      const record = records.find((r) => r.kind === "practice" && r.id === practice.id);
      // 已提交次数从练习结果里取（成绩记录里没有这个字段）。
      const attempts =
        Object.values(practiceResults).find(
          (r) => r.practiceId === practice.id && r.studentId === studentId,
        )?.attempts ?? 0;
      return {
        id: practice.id,
        name: practice.name,
        questionCount: practice.questionIds.length,
        durationMin: practice.durationMin,
        totalScore: practice.totalScore,
        tags: practice.tags,
        result: record ? { score: record.score, total: record.total } : null,
        canStart: practice.repeats === 0 || practice.repeats > attempts,
        remainingAttempts: practice.repeats > 0 ? Math.max(0, practice.repeats - attempts) : null,
      };
    });
  }, [practices, records, practiceResults, studentId, enabled]);
}

/** HTTP 模式的练习列表。 */
export function useRemotePracticeList(enabled: boolean): {
  rows: PracticeListRow[];
  loading: boolean;
} {
  const [rows, setRows] = useState<PracticeListRow[]>([]);
  const [loading, setLoading] = useState(false);
  // 标签表：接口给的是标签名，这里换成前端的标签 ID。
  const tags = useCatalog((state) => state.tags);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const [practices, results] = await Promise.all([
          loadMyPractices(),
          loadMyResults().catch(() => []),
        ]);
        if (cancelled) return;

        setRows(
          practices.map((practice) => {
            const record = results.find(
              (row) => row.practiceAssignmentId === practice.id && row.practiceAssignmentId,
            );
            return {
              id: practice.id,
              name: practice.title,
              questionCount: practice.questionCount,
              durationMin: practice.suggestedMinutes,
              totalScore: practice.totalScore,
              tags: practice.tagNames
                .map((name) => tags.find((tag) => tag.name === name)?.id)
                .filter((id): id is string => Boolean(id)),
              result: record ? { score: record.totalScore, total: record.totalMax } : null,
              canStart: practice.canStart,
              remainingAttempts: practice.remainingAttempts,
            };
          }),
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
  }, [enabled, tags]);

  return { rows, loading };
}

/** 练习中心列表（按数据源分派）。 */
export function usePracticeList(): { rows: PracticeListRow[]; loading: boolean } {
  const remote = isBackendEnabled();
  const local = useLocalPracticeList(!remote);
  const remoteList = useRemotePracticeList(remote);
  return remote ? remoteList : { rows: local, loading: false };
}
