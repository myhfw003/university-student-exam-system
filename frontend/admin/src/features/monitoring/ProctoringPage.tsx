/* ==========================================================================
   知行测评 · 管理端实时监考大屏
   --------------------------------------------------------------------------
   按设计文档 FR-ANT-04 / FR-ANT-05 新建（原型无此模块）。

   实时看到每个考生的状态、切屏次数、断连次数、最后心跳时间与已答题数；
   可发送警告、添加备注、强制交卷。每次处置都写入审计日志。
   ========================================================================== */

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Callout,
  Dialog,
  Empty,
  Field,
  PageHead,
  Segmented,
  Stat,
  TextArea,
  toast,
} from "@exam/shared";
import {
  CANDIDATE_STATUS_LABEL,
  PROCTOR_ACTION_LABEL,
  recordProctorAction,
  setCandidate,
  useAdminOps,
  writeAudit,
} from "@exam/shared/mock/adminOps";
import { useCatalog } from "@exam/shared/mock/catalog";
import type { CandidateStatus, ProctorActionKind } from "@exam/shared/domain/types";
import { Icon } from "@/app/Icon";
import { SessionStatusBadge } from "../shared/bits";
import { useProctorFeed } from "./useProctorFeed";

const STATUS_TONE: Record<CandidateStatus, "ok" | "warn" | "danger" | "neutral"> = {
  not_started: "neutral",
  answering: "ok",
  submitted: "neutral",
  forced_submitted: "danger",
  disconnected: "warn",
};

/** 监考大屏。 */
export function ProctoringPage() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const sessions = useAdminOps((state) => state.sessions);
  const actions = useAdminOps((state) => state.proctorActions);
  const students = useCatalog((state) => state.students);

  const session = useMemo(() => sessions.find((s) => s.id === sessionId), [sessions, sessionId]);
  const feed = useProctorFeed(sessionId || undefined);

  const [statusFilter, setStatusFilter] = useState<"all" | CandidateStatus>("all");
  const [dialog, setDialog] = useState<{
    studentId: string;
    kind: ProctorActionKind;
  } | null>(null);
  const [reason, setReason] = useState("");

  const candidates = feed.candidates;
  const filtered = candidates.filter((c) => statusFilter === "all" || c.status === statusFilter);

  // 虚拟滚动：只渲染可视区的行（§7.3 的 1000 考生场景）。
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 12,
  });
  const measured = virtualizer.getVirtualItems();
  // 未测得容器高度时（首帧、或无布局环境如 jsdom）退回整表渲染，
  // 避免出现「表格空着」的中间态。
  const virtualRows =
    measured.length > 0
      ? measured
      : filtered.map((_, index) => ({ index, key: index, start: 0, end: 0, size: 0 }));

  const answering = candidates.filter((c) => c.status === "answering").length;
  const submittedCount = candidates.filter(
    (c) => c.status === "submitted" || c.status === "forced_submitted",
  ).length;
  const disconnected = candidates.filter((c) => c.status === "disconnected").length;
  const overLimit = candidates.filter(
    (c) => session && c.focusLossCount >= session.policy.maxFocusLoss,
  ).length;

  const handleAct = () => {
    if (!dialog || !session) return;
    const result = recordProctorAction({
      sessionId: session.id,
      studentId: dialog.studentId,
      kind: dialog.kind,
      reason,
      operator: "陈砚之",
    });
    if (!result.ok) {
      toast.error(result.message ?? "处置失败");
      return;
    }

    // 强制交卷即时改写该考生的状态。
    if (dialog.kind === "force_submit") {
      const candidate = candidates.find((c) => c.studentId === dialog.studentId);
      if (candidate) {
        setCandidate({
          ...candidate,
          status: "forced_submitted",
          forcedReason: reason,
          submittedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
        });
      }
    }

    writeAudit({
      operator: "陈砚之",
      action: "attempt.force_submit",
      targetType: "exam_session",
      targetId: session.id,
      summary: `对考生「${
        candidates.find((c) => c.studentId === dialog.studentId)?.displayName ??
        students.find((s) => s.id === dialog.studentId)?.name ??
        dialog.studentId
      }」执行${PROCTOR_ACTION_LABEL[dialog.kind]}${reason ? `：${reason}` : ""}`,
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    });

    toast.ok(`${PROCTOR_ACTION_LABEL[dialog.kind]}已下发`);
    setDialog(null);
    setReason("");
  };

  // 没带场次时先让管理员挑一个：侧栏「实时监考」指向的就是这个路由，
  // 没有这一屏的话点侧栏会落到 404。
  if (!sessionId) {
    return (
      <>
        <PageHead
          title="实时监考"
          sub="选择一个考试场次，进入考生状态大屏。"
          actions={<Button onClick={() => navigate("/exam-sessions")}>返回场次列表</Button>}
        />

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">可监考场次</h2>
            <span className="text-sm text-3">共 {sessions.length} 场</span>
          </div>
          <div className="card-body is-flush">
            {sessions.length === 0 ? (
              <Empty
                title="暂无可监考场次"
                body="先在「考试场次」里发布一场考试，再回到这里监考。"
                action={
                  <Button variant="primary" onClick={() => navigate("/exam-sessions")}>
                    去考试场次
                  </Button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">场次</th>
                      <th scope="col">状态</th>
                      <th scope="col">开考时间</th>
                      <th scope="col">结束时间</th>
                      <th scope="col">考生</th>
                      <th className="right" scope="col" aria-label="操作" />
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <div className="strong" style={{ fontWeight: 500 }}>
                            {s.name}
                          </div>
                          <div className="text-xs text-3 mono">{s.id}</div>
                        </td>
                        <td>
                          <SessionStatusBadge status={s.status} />
                        </td>
                        <td className="text-xs">{s.openAt}</td>
                        <td className="text-xs">{s.closeAt}</td>
                        <td className="num">{s.roster.length} 人</td>
                        <td className="col-actions">
                          {s.status === "in_progress" ? (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => navigate(`/monitoring/${s.id}`)}
                            >
                              进入监考
                            </Button>
                          ) : (
                            <span className="text-xs text-3">仅进行中的场次可监考</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </>
    );
  }

  if (!session) {
    return (
      <PageHead
        title="监考场次不存在"
        sub="该场次可能已被删除。"
        actions={
          <Button variant="primary" onClick={() => navigate("/exam-sessions")}>
            返回场次列表
          </Button>
        }
      />
    );
  }

  return (
    <>
      <PageHead
        title={`实时监考 · ${session.name}`}
        sub={`每 2 秒批量刷新一次；最近更新 ${new Date(feed.updatedAt).toLocaleTimeString("zh-CN")}。`}
        actions={
          <>
            <Button onClick={() => navigate(`/exam-sessions/${session.id}`)}>场次详情</Button>
            <Button variant="primary" onClick={feed.refresh}>
              <Icon name="refresh" />
              立即刷新
            </Button>
          </>
        }
      />

      <div className="stat-row" style={{ marginBottom: "var(--sp-4)" }}>
        <Stat label="在场考生" value={candidates.length} unit="人" hint="按物化名单" />
        <Stat label="作答中" value={answering} unit="人" hint="实时快照" />
        <Stat label="已交卷" value={submittedCount} unit="人" hint="含强制交卷" />
        <Stat label="断连中" value={disconnected} unit="人" hint="超过心跳阈值" />
        <Stat
          label="切屏超限"
          value={overLimit}
          unit="人"
          hint={`上限 ${session.policy.maxFocusLoss} 次`}
        />
      </div>

      <Callout tone="info" title="防作弊能力边界">
        本页展示的是**可审计、可威慑**的运行证据：切屏计数、断连检测、心跳留痕与教师处置均记录在案。
        客户端检测可被篡改，系统不宣称能杜绝作弊。
      </Callout>

      <section className="card" style={{ marginTop: "var(--sp-4)" }}>
        <div className="card-head">
          <h2 className="card-title">考生状态</h2>
          <Segmented
            label="状态筛选"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all" as const, label: "全部" },
              ...(Object.keys(CANDIDATE_STATUS_LABEL) as CandidateStatus[]).map((s) => ({
                value: s,
                label: CANDIDATE_STATUS_LABEL[s],
              })),
            ]}
          />
        </div>
        <div className="card-body is-flush">
          {/* 1000 考生时整表渲染会拖垮监考视图：这里用虚拟滚动只渲染可视行
              （docs/design/06-frontend.md §7.3）。 */}
          <div
            className="table-wrap"
            ref={scrollRef}
            style={{ maxHeight: "58vh", overflowY: "auto" }}
          >
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">考生</th>
                  <th scope="col">状态</th>
                  <th scope="col">切屏</th>
                  <th scope="col">断连</th>
                  <th scope="col">最后心跳</th>
                  <th scope="col">已答题</th>
                  <th scope="col">交卷时间</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <Empty
                        title="暂无考生数据"
                        body="名单物化后，监考视图会每 2 秒聚合一次考生状态。"
                      />
                    </td>
                  </tr>
                ) : (
                  <>
                    {/* 顶部占位：撑出虚拟滚动需要的空白高度。 */}
                    <tr
                      aria-hidden="true"
                      style={{ height: virtualRows[0]?.start ?? 0, border: 0 }}
                    >
                      <td colSpan={8} style={{ padding: 0, border: 0 }} />
                    </tr>
                    {virtualRows.map((virtualRow) => {
                      const c = filtered[virtualRow.index];
                      if (!c) return null;
                      const student = students.find((s) => s.id === c.studentId);
                      return (
                        <tr
                          key={c.studentId}
                          data-index={virtualRow.index}
                          ref={virtualizer.measureElement}
                        >
                          <td>
                            <div className="strong" style={{ fontWeight: 500 }}>
                              {c.displayName ?? student?.name ?? c.studentId}
                            </div>
                            <div className="text-xs text-3 mono">{c.studentId}</div>
                          </td>
                          <td>
                            <Badge tone={STATUS_TONE[c.status]}>
                              {CANDIDATE_STATUS_LABEL[c.status]}
                            </Badge>
                            {c.forcedReason ? (
                              <div className="text-xs text-3">{c.forcedReason}</div>
                            ) : null}
                          </td>
                          <td className="num">
                            {c.focusLossCount > 0 ? (
                              <Badge
                                tone={
                                  c.focusLossCount >= session.policy.maxFocusLoss
                                    ? "danger"
                                    : "warn"
                                }
                              >
                                {c.focusLossCount}
                              </Badge>
                            ) : (
                              <span className="text-3">0</span>
                            )}
                          </td>
                          <td className="num">{c.disconnectCount}</td>
                          <td className="text-xs text-3">{c.lastHeartbeatAt ?? "—"}</td>
                          <td className="num">
                            {c.answeredCount} / {c.totalCount}
                          </td>
                          <td className="text-xs text-3">{c.submittedAt ?? "—"}</td>
                          <td className="col-actions">
                            <Button
                              size="sm"
                              onClick={() => {
                                setDialog({ studentId: c.studentId, kind: "warn" });
                                setReason("");
                              }}
                            >
                              警告
                            </Button>{" "}
                            <Button
                              size="sm"
                              onClick={() => {
                                setDialog({ studentId: c.studentId, kind: "note" });
                                setReason("");
                              }}
                            >
                              备注
                            </Button>{" "}
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => {
                                setDialog({ studentId: c.studentId, kind: "force_submit" });
                                setReason("");
                              }}
                            >
                              强制交卷
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                    {/* 底部占位。 */}
                    <tr
                      aria-hidden="true"
                      style={{
                        height: Math.max(
                          0,
                          virtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? 0),
                        ),
                        border: 0,
                      }}
                    >
                      <td colSpan={8} style={{ padding: 0, border: 0 }} />
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {actions.length > 0 ? (
        <section className="card" style={{ marginTop: "var(--sp-4)" }}>
          <div className="card-head">
            <h2 className="card-title">处置记录</h2>
            <span className="text-sm text-3">{actions.length} 条</span>
          </div>
          <div className="card-body is-flush">
            <ul className="list">
              {actions.slice(0, 20).map((a) => (
                <li className="list-row" key={a.id}>
                  <div className="list-main">
                    <div className="list-title">
                      {students.find((s) => s.id === a.studentId)?.name ?? a.studentId}
                      <Badge tone="info" className="badge">
                        {PROCTOR_ACTION_LABEL[a.kind]}
                      </Badge>
                    </div>
                    <div className="list-sub">
                      {a.reason || "（无原因）"} · {a.operator} · {a.createdAt}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={
          dialog
            ? `${PROCTOR_ACTION_LABEL[dialog.kind]} · ${
                candidates.find((c) => c.studentId === dialog.studentId)?.displayName ??
                students.find((s) => s.id === dialog.studentId)?.name ??
                dialog.studentId
              }`
            : ""
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleAct}>
              确认
            </Button>
          </>
        }
      >
        <Field
          htmlFor="proctor-reason"
          label={dialog?.kind === "force_submit" ? "强制交卷原因" : "说明"}
          required={dialog?.kind === "force_submit"}
          hint={
            dialog?.kind === "force_submit"
              ? "强制交卷必须注明原因，该原因会在考生端可见并写入审计日志。"
              : "处置内容会写入审计日志。"
          }
        >
          <TextArea
            id="proctor-reason"
            value={reason}
            placeholder={
              dialog?.kind === "force_submit" ? "例如：切屏次数超限，疑似离开考场" : "处置说明"
            }
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </Dialog>
    </>
  );
}
