/* ==========================================================================
   知行测评 · 管理端审计日志数据通路
   --------------------------------------------------------------------------
   审计日志是**追加式**的：只能读，不能改、不能删。

   过滤口径有一处不对齐：后端支持按动作、对象类型、对象 ID、操作者 ID 与
   时间范围过滤，但**操作者是按 ID 筛的**，而页面上选的是操作者**名字**。
   所以：动作与对象类型交给服务端，操作者与关键词在前端这一页里筛。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import { isBackendEnabled, loadAuditLogs } from "@exam/shared/api";
import { useAdminOps } from "@exam/shared/mock/adminOps";
import { auditActionLabel } from "@exam/shared/domain/audit";

/** 审计日志的一行（mock 与 HTTP 同一形状）。 */
export interface AuditLogRow {
  id: string;
  /** 发生时间。 */
  at: string;
  /** 操作者名。 */
  operator: string;
  /** 动作码。 */
  action: string;
  /** 动作中文名；后端有前端没登记的动作时原样显示动作码。 */
  actionLabel: string;
  /** 目标对象类型。 */
  targetType: string;
  /** 目标对象 ID。 */
  targetId: string;
  /** 变更摘要。 */
  summary: string;
  /** 来源 IP。 */
  ip: string;
  /** 客户端 UA。 */
  userAgent: string;
}

/**
 * 审计日志列表。
 *
 * @param filter 动作、对象类型（服务端过滤）与操作者、关键词（前端过滤）。
 */
export function useAuditLogs(filter: {
  action: string;
  targetType: string;
  operator: string;
  keyword: string;
}): { rows: AuditLogRow[]; total: number; loading: boolean; refresh: () => void } {
  const remote = isBackendEnabled();
  const mockLogs = useAdminOps((state) => state.auditLogs);

  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const page = await loadAuditLogs({
          action: filter.action,
          targetType: filter.targetType.trim() || undefined,
        });
        if (cancelled) return;
        setRows(page.items.map((item) => ({ ...item, actionLabel: auditActionLabel(item.action) })));
        setServerTotal(page.total);
      } catch {
        if (!cancelled) {
          setRows([]);
          setServerTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, filter.action, filter.targetType, token]);

  const mockRows = useMemo<AuditLogRow[]>(() => {
    if (remote) return [];
    return mockLogs
      .filter((log) => {
        if (filter.action !== "all" && log.action !== filter.action) return false;
        if (filter.targetType && log.targetType !== filter.targetType) return false;
        return true;
      })
      .map((log) => ({
        id: log.id,
        at: log.at,
        operator: log.operator,
        action: log.action,
        actionLabel: auditActionLabel(log.action),
        targetType: log.targetType,
        targetId: log.targetId,
        summary: log.summary,
        ip: log.ip,
        userAgent: log.userAgent,
      }));
  }, [remote, mockLogs, filter.action, filter.targetType]);

  // 操作者与关键词在前端这一页里筛：后端的操作者过滤是按 ID 的，
  // 而页面上选的是操作者名字，对不上。
  const visible = useMemo<AuditLogRow[]>(() => {
    const source = remote ? rows : mockRows;
    return source.filter((row) => {
      if (filter.operator && row.operator !== filter.operator) return false;
      if (filter.keyword) {
        const kw = filter.keyword.toLowerCase();
        if (!`${row.summary} ${row.targetId} ${row.ip}`.toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [remote, rows, mockRows, filter.operator, filter.keyword]);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  return {
    rows: visible,
    // 总数是服务端给的（HTTP 模式）；操作者与关键词在前端筛，
    // 所以「已显示 / 共 N 条」两个数可能对不上——这是口径，不是 bug。
    total: remote ? serverTotal : mockRows.length,
    loading,
    refresh,
  };
}
