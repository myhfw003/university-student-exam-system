/* ==========================================================================
   知行测评 · 管理端审计日志
   --------------------------------------------------------------------------
   按设计文档 §2.8 新建（原型无此模块）。追加式写入，仅管理员可查，
   支持按操作者 / 动作 / 时间范围 / 对象过滤。

   数据通路见 `useAuditLogs.ts`：动作、对象类型与时间范围交给服务端过滤，
   操作者与关键词在前端这一页里筛（后端的操作者过滤是按 ID 的）。
   ========================================================================== */

import { useMemo, useState } from "react";
import { Badge, Empty, Field, PageHead, SearchInput, Segmented, SelectInput, TextInput } from "@exam/shared";
import { AUDIT_ACTION_GROUPS, AUDIT_ACTION_LABEL } from "@exam/shared/domain/audit";
import type { AuditAction } from "@exam/shared/domain/types";
import { useAuditLogs } from "./useAuditLogs";

/** 审计日志页。 */
export function AuditLogPage() {
  const [operator, setOperator] = useState("");
  const [action, setAction] = useState<"all" | AuditAction>("all");
  const [target, setTarget] = useState("");
  const [keyword, setKeyword] = useState("");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");

  const { rows, total } = useAuditLogs({
    action,
    targetType: target,
    operator,
    keyword,
    fromDay,
    toDay,
  });

  // 操作者下拉来自当前这一页里出现过的操作者。
  const operators = useMemo(() => [...new Set(rows.map((row) => row.operator))], [rows]);

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
            {rows.length} / {total} 条
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
            {/* 69 个动作塞不进分段控件，按业务域分组下拉。 */}
            <Field label="动作筛选" htmlFor="audit-action">
              <SelectInput
                id="audit-action"
                value={action}
                onChange={(event) => setAction(event.target.value as "all" | AuditAction)}
              >
                <option value="all">全部动作</option>
                {AUDIT_ACTION_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.actions.map((code) => (
                      <option key={code} value={code}>
                        {AUDIT_ACTION_LABEL[code]}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </SelectInput>
            </Field>
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
          {/* 时间范围：FR-IAM-07 要的四种筛选之一。日期按本地日历日选，
              翻成时间点交给服务端（见 timeRange.ts）。 */}
          <div className="row" style={{ marginTop: "var(--sp-3)" }}>
            <Field label="起始日期" htmlFor="audit-from">
              <TextInput
                id="audit-from"
                type="date"
                value={fromDay}
                onChange={(event) => setFromDay(event.target.value)}
              />
            </Field>
            <Field label="结束日期" htmlFor="audit-to">
              <TextInput
                id="audit-to"
                type="date"
                value={toDay}
                onChange={(event) => setToDay(event.target.value)}
              />
            </Field>
          </div>
        </div>
        <div className="card-body is-flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">时间</th>
                  <th scope="col">操作者</th>
                  <th scope="col">动作</th>
                  <th scope="col">对象</th>
                  <th scope="col">摘要</th>
                  <th scope="col">来源</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <Empty title="没有符合条件的日志" body="调整筛选条件后重试。" />
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id}>
                      <td className="text-xs text-3 nowrap">{row.at}</td>
                      <td>{row.operator}</td>
                      <td>
                        <Badge tone="info">{row.actionLabel}</Badge>
                      </td>
                      <td className="text-xs mono">
                        {row.targetType}
                        <br />
                        {row.targetId}
                      </td>
                      <td>{row.summary}</td>
                      <td className="text-xs text-3">
                        {row.ip}
                        <br />
                        {row.userAgent}
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
