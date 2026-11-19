/* ==========================================================================
   知行测评 · 成绩报告（HTTP 模式）
   --------------------------------------------------------------------------
   成绩由服务端判完再下发，前端不重算。这里把三份数据拼起来：

   - `GET /exam-sessions/{id}`：场次（名称、卷型、试卷 ID）；
   - `GET /my/results`：该场次的成绩条目（用来挑哪一次作答——重考按最高分）；
   - `GET /attempts/{id}`：考生卷面（选项顺序、标签、步骤）；
   - `GET /attempts/{id}/report`：成绩与逐题明细。

   卷面与报告缺一不可：报告里有得分与答案，但没有选项顺序，
   正确答案与考生作答都要靠卷面的换算表才能还原成显示字母。
   ========================================================================== */

import { useEffect, useState } from "react";
import {
  getAttempt,
  isBackendEnabled,
  listMyAttempts,
  loadAttemptReport,
  loadGradeRevisions,
  loadExamSession,
  loadMyResults,
  toPaperMode,
} from "@exam/shared/api";
import { gradedPaperFromReport } from "@exam/shared/engine";
import type { GradedWithTeacher } from "@exam/shared/engine/scoring";
import type { PaperMode } from "@exam/shared/domain/types";
import type { GradeRevision } from "@exam/shared/domain/attempt";

/** 成绩报告视图数据。 */
export interface ExamReportData {
  /** 考试名称。 */
  examName: string;
  /** 卷型。 */
  mode: PaperMode;
  /** 试卷 ID（标签与批次从内容目录里取）。 */
  paperId: string;
  /** 判分明细。 */
  graded: GradedWithTeacher;
  /** 交卷时间。 */
  submittedAt: string | null;
  /** 第几次作答。 */
  attemptNo: number;
  /**
   * 改分流水：阅卷教师改过分数的痕迹。
   *
   * 没有改分就是空数组；流水读不到也不影响成绩本身。
   */
  revisions: GradeRevision[];
}

/** 找出这场考试里成绩最好的一次作答（重考按最高分计入）。 */
async function resolveAttemptId(sessionId: string): Promise<string | null> {
  const results = await loadMyResults().catch(() => []);
  const mine = results.filter((row) => row.examSessionId === sessionId);
  if (mine.length > 0) {
    const best = mine.sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "");
    })[0];
    if (best) return best.attemptId;
  }

  // 成绩还没生成时退回「我的作答」列表：取最近一次已交卷的。
  const attempts = await listMyAttempts().catch(() => []);
  const submitted = attempts
    .filter((a) => a.examSessionId === sessionId && a.submittedAt !== null)
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
  return submitted[0]?.id ?? null;
}

/**
 * HTTP 模式的成绩报告。
 *
 * mock 模式返回 null——那条路走本地内容仓库，由页面自己算。
 */
export function useExamReport(
  sessionId: string,
  enabled = isBackendEnabled(),
): {
  data: ExamReportData | null;
  loading: boolean;
  error: string | null;
} {
  const remote = enabled;

  const [data, setData] = useState<ExamReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!remote || !sessionId) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const session = await loadExamSession(sessionId);
        const attemptId = await resolveAttemptId(sessionId);
        if (cancelled) return;

        if (!attemptId) {
          setData(null);
          return;
        }

        const [surface, report, revisions] = await Promise.all([
          getAttempt(attemptId),
          loadAttemptReport(attemptId),
          // 改分流水读不到不影响成绩：拿不到就当没有改分记录。
          loadGradeRevisions(attemptId).catch(() => []),
        ]);
        if (cancelled) return;

        setData({
          examName: report.examName ?? session.name,
          paperId: session.paperId,
          mode: toPaperMode(session.variantRule),
          graded: gradedPaperFromReport(surface, report),
          submittedAt: report.submittedAt,
          attemptNo: report.attemptNo,
          revisions,
        });
      } catch {
        if (!cancelled) setError("成绩报告读取失败，请稍后重试。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [remote, sessionId]);

  return { data: remote ? data : null, loading, error };
}
