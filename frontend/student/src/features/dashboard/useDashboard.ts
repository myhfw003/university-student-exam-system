/* ==========================================================================
   知行测评 · 学生工作台（HTTP 模式）
   --------------------------------------------------------------------------
   工作台的统计口径都在服务端：待完成练习、进行中考试、学期平均分、
   待订正错题、推荐练习、最近成绩、成绩趋势与错题分布。

   前端**不重算**——重算的口径与服务端不一致时，学生看到的两套数会对不上。
   mock 模式走本地内容仓库，由页面自己算（`useDashboard` 返回 null）。
   ========================================================================== */

import { useEffect, useState } from "react";
import { isBackendEnabled, loadDashboardSummary } from "@exam/shared/api";
import type { DashboardSummary } from "@exam/shared/domain/learning";

/**
 * 读取工作台汇总。
 *
 * mock 模式返回 null——那一支在页面里本地算。
 */
export function useDashboard(enabled = isBackendEnabled()): {
  summary: DashboardSummary | null;
  loading: boolean;
} {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const loaded = await loadDashboardSummary();
        if (!cancelled) setSummary(loaded);
      } catch {
        if (!cancelled) setSummary(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { summary: enabled ? summary : null, loading };
}
