/* ==========================================================================
   知行测评 · 管理端审计日志
   --------------------------------------------------------------------------
   按设计文档 §2.8 新建（原型无此模块）。追加式写入，仅管理员可查，
   支持按操作者 / 动作 / 时间范围 / 对象过滤。
   ========================================================================== */

import { useMemo, useState } from "react";
import { Badge, Empty, PageHead, SearchInput, Segmented, TextInput } from "@exam/shared";
import { AUDIT_ACTION_LABEL, useAdminOps } from "@exam/shared/mock/adminOps";
import type { AuditAction } from "@exam/shared/domain/types";

/** 审计日志页。 */
export function AuditLogPage() {
  const logs = useAdminOps((state) => state.auditLogs);

  const [operator, setOperator] = useState("");
  const [action, setAction] = useState<"all" | AuditAction>("all");
  const [target, setTarget] = useState("");
  const [keyword, setKeyword] = useState("");

  const operators = useMemo(
    () => [...new Set(logs.map((l) => l.operator))],
    [logs],
  );

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (operator && l.operator !== operator) return false;
      if (action !== "all" && l.action !== action) return false;
      if (target && l.targetType !== target) return false;
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (!`${l.summary} ${l.targetId} ${l.ip}`.toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [logs, operator, action, target, keyword]);

  return (
    <>
      <PageHead
        title="审计"
        sub="记录操作者、动作、目标对象、变更前后摘要、IP、UA 与时间。日志为追加式，仅管理员可查，不可修改或删除。"
      />

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">审计日志</h2>
          <span className="text-sm text-3">
            {filtered.length} / {logs.length} 条
          </span>
        </div>
        <div className="card-body">
          <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
            <Segmented
              label="操作者筛选"
              value={operator}
              onChange={setOperator}
              options={[
                { value: "", label: "全部操作者" },
                ...operators.map((name) => ({ value: name, label: name })),
              ]}
            />
          </div>
          <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
            <Segmented
              label="动作筛选"
              value={action}
              onChange={setAction}
              options={[
                { value: "all" as const, label: "全部动作" },
                ...(Object.keys(AUDIT_ACTION_LABEL) as AuditAction[])
                  .filter((a) => logs.some((l) => l.action === a))
                  .map((a) => ({ value: a, label: AUDIT_ACTION_LABEL[a] })),
              ]}
            />
          </div>
          <div className="row">
            <SearchInput
              label="搜索摘要、对象或 IP"
              value={keyword}
              placeholder="搜索摘要、对象或 IP"
              onSearch={setKeyword}
              onChange={setKeyword}
            />
            <TextInput
              aria-label="对象类型筛选"
              placeholder="对象类型（如 question）"
              value={target}
              onChange={(event) => setTarget(event.target.value.trim())}
            />
          </div>
        </div>
        <div className="card-body is-flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作者</th>
                  <th>动作</th>
                  <th>对象</th>
                  <th>摘要</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <Empty title="没有符合条件的日志" body="调整筛选条件后重试。" />
                    </td>
                  </tr>
                ) : (
                  filtered.map((l) => (
                    <tr key={l.id}>
                      <td className="text-xs text-3 nowrap">{l.at}</td>
                      <td>{l.operator}</td>
                      <td>
                        <Badge tone="info">{AUDIT_ACTION_LABEL[l.action]}</Badge>
                      </td>
                      <td className="text-xs mono">
                        {l.targetType}
                        <br />
                        {l.targetId}
                      </td>
                      <td>{l.summary}</td>
                      <td className="text-xs text-3">
                        {l.ip}
                        <br />
                        {l.userAgent}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
