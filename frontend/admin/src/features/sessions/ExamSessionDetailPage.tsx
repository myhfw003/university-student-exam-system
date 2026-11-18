/* ==========================================================================
   知行测评 · 管理端场次详情
   --------------------------------------------------------------------------
   展示场次配置、防作弊策略、名单与考生状态，并提供监考入口。

   数据来源：
   - 场次配置 / 策略 / 名单 / 成绩：`useAdminSessionDetail`（mock 与 HTTP 各一份）；
   - 考生实时状态：`useProctorFeed`（HTTP 模式轮询真实监考快照）。
   ========================================================================== */

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Callout,
  Empty,
  PageHead,
  Stat,
  TextInput,
  downloadCsv,
  toast,
} from "@exam/shared";
import { SESSION_STATUS_LABEL } from "@exam/shared/mock/adminOps";
import { Icon } from "@/app/Icon";
import { useProctorFeed } from "../monitoring/useProctorFeed";
import { useAdminSessionDetail } from "./useAdminSessions";

/** 场次详情页。 */
export function ExamSessionDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const view = useAdminSessionDetail(id);
  const feed = useProctorFeed(id);

  const [maxFocusLoss, setMaxFocusLoss] = useState<number | null>(null);

  const candidates = feed.candidates;
  const submitted = candidates.filter((c) => c.status === "submitted" || c.status === "forced_submitted");
  const answering = candidates.filter((c) => c.status === "answering");
  const disconnected = candidates.filter((c) => c.status === "disconnected");
  const focusLossTotal = candidates.reduce((sum, c) => sum + c.focusLossCount, 0);

  /** 导出单场次成绩 CSV（FR-AUD-03）。 */
  const handleExportScores = () => {
    const rows: Array<Array<string | number>> = [
      ["学号", "姓名", "状态", "得分", "满分", "交卷时间"],
    ];
    const gradeByUser = new Map(view.grades.map((grade) => [grade.userId, grade]));
    const roster = view.roster.length > 0 ? view.roster : [];
    for (const entry of roster) {
      const grade = gradeByUser.get(entry.userId);
      const candidate = candidates.find((c) => c.studentId === entry.userId);
      rows.push([
        grade?.username || entry.userId,
        grade?.displayName || entry.displayName || entry.userId,
        candidate?.status === "submitted"
          ? "已交卷"
          : candidate?.status === "forced_submitted"
            ? "已强制交卷"
            : candidate?.status === "answering"
              ? "作答中"
              : candidate?.status === "disconnected"
                ? "断连中"
                : "未开始",
        grade?.score ?? "",
        grade?.total ?? "",
        grade?.submittedAt ?? "",
      ]);
    }
    // 有成绩但不在名单里的（名单口径与成绩口径不一致时）也要导出，否则会丢行。
    for (const grade of view.grades) {
      if (roster.some((entry) => entry.userId === grade.userId)) continue;
      rows.push([
        grade.username || grade.userId,
        grade.displayName || grade.userId,
        "已交卷",
        grade.score ?? "",
        grade.total ?? "",
        grade.submittedAt ?? "",
      ]);
    }
    downloadCsv(`场次成绩_${view.paperName || view.id}.csv`, rows);
    toast.ok("场次成绩已导出");
  };

  if (view.missing) {
    return (
      <PageHead
        title="场次不存在"
        sub="该场次可能已被删除，或你还没有它的查看权限。"
        actions={
          <Button variant="primary" onClick={() => navigate("/exam-sessions")}>
            返回场次列表
          </Button>
        }
      />
    );
  }

  const policy = view.policy;
  const statusLabel = view.statusLabel || SESSION_STATUS_LABEL[view.status];

  const savePolicy = async (patch: Partial<typeof policy>) => {
    try {
      await view.savePolicy(patch);
      toast.ok("防作弊策略已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  const handlePublish = async () => {
    try {
      await view.publish();
      toast.ok("场次已发布，名单已物化");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发布失败");
    }
  };

  const handleClose = async () => {
    try {
      await view.close();
      toast.ok("场次已结束");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "结束失败");
    }
  };

  const handleCancel = async () => {
    try {
      await view.cancel();
      toast.ok("场次已取消");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "取消失败");
    }
  };

  return (
    <>
      <PageHead
        title={view.name}
        sub={`场次 ${view.id} · 来源试卷：${view.paperName} · ${view.openAt} 至 ${view.closeAt}`}
        actions={
          <>
            <Button onClick={() => navigate("/exam-sessions")}>返回场次列表</Button>
            <Button onClick={() => navigate(`/monitoring/${view.id}`)}>
              <Icon name="eye" />
              实时监考
            </Button>
            {view.status === "scheduled" ? (
              <Button variant="primary" onClick={handlePublish}>
                发布场次
              </Button>
            ) : view.status === "in_progress" ? (
              <Button variant="primary" onClick={handleClose}>
                结束考试
              </Button>
            ) : null}
          </>
        }
      />

      <div className="stat-row" style={{ marginBottom: "var(--sp-4)" }}>
        <Stat label="名单人数" value={view.roster.length} unit="人" hint="发布时物化" />
        <Stat label="已交卷" value={submitted.length} unit="人" hint="含强制交卷" />
        <Stat label="作答中" value={answering.length} unit="人" hint="实时快照" />
        <Stat label="断连中" value={disconnected.length} unit="人" hint="超过心跳阈值" />
        <Stat label="切屏累计" value={focusLossTotal} unit="次" hint="全部考生合计" />
      </div>

      <div className="grid-main">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">场次配置</h2>
            <Badge
              tone={
                view.status === "in_progress"
                  ? "ok"
                  : view.status === "cancelled"
                    ? "danger"
                    : "warn"
              }
            >
              {statusLabel}
            </Badge>
          </div>
          <div className="card-body">
            <dl className="kv">
              <dt>来源试卷</dt>
              <dd>{view.paperName}</dd>
              <dt>卷型</dt>
              <dd>{view.mode === "small" ? "小梅花" : view.mode === "large" ? "大梅花" : "标准卷"}</dd>
              <dt>时间窗</dt>
              <dd>
                {view.openAt} 至 {view.closeAt}
              </dd>
              <dt>作答时长</dt>
              <dd>{view.durationMin} 分钟</dd>
              <dt>补考</dt>
              <dd>{view.allowRetake ? "允许重考，成绩取最高分" : "不允许重考"}</dd>
              <dt>名单来源</dt>
              <dd>{view.rosterSource}</dd>
              <dt>考生须知</dt>
              <dd>{view.note || "—"}</dd>
            </dl>
          </div>
          <div className="card-foot">
            <Button variant="danger" onClick={handleCancel} disabled={view.status === "closed"}>
              取消场次
            </Button>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">防作弊策略</h2>
          </div>
          <div className="card-body">
            <div className="field" style={{ marginBottom: "var(--sp-4)" }}>
              <label className="field-label" htmlFor="sess-focus">
                切屏上限
              </label>
              <TextInput
                id="sess-focus"
                type="number"
                min={0}
                max={20}
                value={maxFocusLoss ?? policy.maxFocusLoss}
                onChange={(e) => setMaxFocusLoss(Number(e.target.value) || 0)}
                onBlur={() => {
                  if (maxFocusLoss !== null) {
                    void savePolicy({ maxFocusLoss });
                    setMaxFocusLoss(null);
                  }
                }}
              />
              <span className="field-hint">
                达到 {policy.maxFocusLoss} 次后按「
                {policy.onExceeded === "warn" ? "警告" : "强制交卷"}」处置。
              </span>
            </div>
            <div className="field" style={{ marginBottom: "var(--sp-4)" }}>
              <span className="field-label">超限处置</span>
              <div className="row-tight">
                <button
                  type="button"
                  className={`chip${policy.onExceeded === "warn" ? " is-on" : ""}`}
                  aria-pressed={policy.onExceeded === "warn"}
                  onClick={() => void savePolicy({ onExceeded: "warn" })}
                >
                  警告
                </button>
                <button
                  type="button"
                  className={`chip${policy.onExceeded === "force_submit" ? " is-on" : ""}`}
                  aria-pressed={policy.onExceeded === "force_submit"}
                  onClick={() => void savePolicy({ onExceeded: "force_submit" })}
                >
                  强制交卷
                </button>
              </div>
            </div>
            <div className="grid-2">
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={policy.requireFullscreen}
                  onChange={(e) => void savePolicy({ requireFullscreen: e.target.checked })}
                />
                <span className="checkline-text">要求全屏</span>
              </label>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={policy.disableCopyPaste}
                  onChange={(e) => void savePolicy({ disableCopyPaste: e.target.checked })}
                />
                <span className="checkline-text">禁用复制粘贴</span>
              </label>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={policy.disableContextMenu}
                  onChange={(e) => void savePolicy({ disableContextMenu: e.target.checked })}
                />
                <span className="checkline-text">禁用右键菜单</span>
              </label>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={policy.watermark}
                  onChange={(e) => void savePolicy({ watermark: e.target.checked })}
                />
                <span className="checkline-text">叠加姓名与账号水印</span>
              </label>
            </div>
            <div className="field" style={{ marginTop: "var(--sp-4)" }}>
              <span className="field-label">心跳与断连</span>
              <div className="text-sm text-3">
                每 {policy.heartbeatIntervalSec} 秒一次心跳，超过{" "}
                {policy.disconnectThresholdSec} 秒未收到判为断连。
              </div>
            </div>
            <Callout tone="info" title="能力边界声明">
              防作弊为「可审计 + 可威慑」：客户端检测可被篡改，系统通过服务端权威计时、试卷差异化、
              答案追加流水与监考留痕共同降低舞弊空间，**不宣称绝对防作弊**。
            </Callout>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: "var(--sp-4)" }}>
        <div className="card-head">
          <h2 className="card-title">考生名单</h2>
          <div className="row-tight">
            <span className="text-sm text-3">{view.roster.length} 人 · 发布时物化</span>
            <Button size="sm" onClick={handleExportScores}>
              导出成绩
            </Button>
          </div>
        </div>
        <div className="card-body is-flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">学号</th>
                  <th scope="col">姓名</th>
                  <th scope="col">名单组</th>
                  <th scope="col">状态</th>
                  <th scope="col">切屏</th>
                  <th scope="col">已答题</th>
                  <th scope="col">得分</th>
                </tr>
              </thead>
              <tbody>
                {view.roster.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <Empty title="名单尚未物化" body="发布场次时会按组织标签展开并物化考生名单。" />
                    </td>
                  </tr>
                ) : (
                  view.roster.map((entry) => {
                    const candidate = candidates.find((c) => c.studentId === entry.userId);
                    const grade = view.grades.find((g) => g.userId === entry.userId);
                    return (
                      <tr key={entry.userId}>
                        <td className="mono text-xs">{entry.userId}</td>
                        <td>{entry.displayName || entry.userId}</td>
                        <td>{entry.className || "—"}</td>
                        <td>
                          {candidate ? (
                            <Badge
                              tone={
                                candidate.status === "answering"
                                  ? "ok"
                                  : candidate.status === "disconnected"
                                    ? "warn"
                                    : candidate.status === "forced_submitted"
                                      ? "danger"
                                      : "neutral"
                              }
                            >
                              {candidate.status === "not_started"
                                ? "未开始"
                                : candidate.status === "answering"
                                  ? "作答中"
                                  : candidate.status === "submitted"
                                    ? "已交卷"
                                    : candidate.status === "forced_submitted"
                                      ? "已强制交卷"
                                      : "断连中"}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="num">{candidate?.focusLossCount ?? 0}</td>
                        <td className="num">
                          {candidate ? `${candidate.answeredCount} / ${candidate.totalCount}` : "—"}
                        </td>
                        <td className="num">
                          {grade && grade.score !== null ? `${grade.score} / ${grade.total}` : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
