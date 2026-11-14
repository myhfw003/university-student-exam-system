/* ==========================================================================
   知行测评 · 管理端场次详情
   --------------------------------------------------------------------------
   展示场次配置、防作弊策略、名单与考生状态，并提供监考入口。
   ========================================================================== */

import { useMemo, useState } from "react";
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
import {
  SESSION_STATUS_LABEL,
  advanceSession,
  cancelSession,
  proctorSnapshot,
  updateSession,
  useAdminOps,
  writeAudit,
} from "@exam/shared/mock/adminOps";
import { className as classNameOf, getExam, useCatalog } from "@exam/shared/mock/catalog";
import { Icon } from "@/app/Icon";

/** 场次详情页。 */
export function ExamSessionDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const sessions = useAdminOps((state) => state.sessions);
  const students = useCatalog((state) => state.students);
  const attempts = useCatalog((state) => state.attempts);
  const records = useCatalog((state) => state.records);

  const [maxFocusLoss, setMaxFocusLoss] = useState<number | null>(null);

  const session = useMemo(() => sessions.find((s) => s.id === id), [sessions, id]);
  const exam = session ? getExam(session.paperId) : undefined;

  /** 导出单场次成绩 CSV（FR-AUD-03）。 */
  const handleExportScores = () => {
    if (!session) return;
    const rows: Array<Array<string | number>> = [
      ["学号", "姓名", "名单组", "状态", "得分", "满分", "交卷时间"],
    ];
    for (const studentId of session.roster) {
      const student = students.find((s) => s.id === studentId);
      const attempt = Object.values(attempts).find(
        (a) => a.examId === session.paperId && a.studentId === studentId,
      );
      const record = records.find(
        (r) => r.examId === session.paperId && r.studentId === studentId,
      );
      const candidate = proctorSnapshot(session.id, 0).find(
        (c) => c.studentId === studentId,
      );
      rows.push([
        studentId,
        student?.name ?? studentId,
        student ? classNameOf(student.classId) : "",
        candidate?.status === "submitted"
          ? "已交卷"
          : candidate?.status === "forced_submitted"
            ? "已强制交卷"
            : candidate?.status === "answering"
              ? "作答中"
              : candidate?.status === "disconnected"
                ? "断连中"
                : "未开始",
        attempt?.score ?? record?.score ?? "",
        attempt?.total ?? record?.total ?? "",
        attempt?.submittedAt ?? record?.date ?? "",
      ]);
    }
    downloadCsv(`场次成绩_${exam?.name ?? session.id}.csv`, rows);
    toast.ok("场次成绩已导出");
  };

  if (!session) {
    return (
      <PageHead
        title="场次不存在"
        sub="该场次可能已被删除。"
        actions={
          <Button variant="primary" onClick={() => navigate("/exam-sessions")}>
            返回场次列表
          </Button>
        }
      />
    );
  }

  const policy = session.policy;
  const candidates = proctorSnapshot(session.id, 0);
  const submitted = candidates.filter((c) => c.status === "submitted" || c.status === "forced_submitted");
  const answering = candidates.filter((c) => c.status === "answering");
  const disconnected = candidates.filter((c) => c.status === "disconnected");
  const focusLossTotal = candidates.reduce((sum, c) => sum + c.focusLossCount, 0);

  const savePolicy = (patch: Partial<typeof policy>) => {
    const result = updateSession(session.id, { policy: { ...policy, ...patch } });
    if (!result.ok) {
      toast.error(result.message ?? "保存失败");
      return;
    }
    toast.ok("防作弊策略已更新");
  };

  const handleAdvance = () => {
    const result = advanceSession(session.id);
    if (!result.ok) {
      toast.error(result.message ?? "状态流转被拒绝");
      return;
    }
    writeAudit({
      operator: "陈砚之",
      action: "session.publish",
      targetType: "exam_session",
      targetId: session.id,
      summary: `场次「${session.name}」状态推进为「${SESSION_STATUS_LABEL[result.status!]}」`,
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    });
    toast.ok(`场次状态已推进为「${SESSION_STATUS_LABEL[result.status!]}」`);
  };

  const handleCancel = () => {
    const result = cancelSession(session.id, "管理员取消");
    if (!result.ok) {
      toast.error(result.message ?? "取消失败");
      return;
    }
    writeAudit({
      operator: "陈砚之",
      action: "session.cancel",
      targetType: "exam_session",
      targetId: session.id,
      summary: `取消场次「${session.name}」`,
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    });
    toast.ok("场次已取消");
  };

  return (
    <>
      <PageHead
        title={session.name}
        sub={`场次 ${session.id} · 来源试卷：${exam?.name ?? session.paperId} · ${session.openAt} 至 ${session.closeAt}`}
        actions={
          <>
            <Button onClick={() => navigate("/exam-sessions")}>返回场次列表</Button>
            <Button onClick={() => navigate(`/monitoring/${session.id}`)}>
              <Icon name="eye" />
              实时监考
            </Button>
            {session.status === "scheduled" ? (
              <Button variant="primary" onClick={handleAdvance}>
                开考
              </Button>
            ) : session.status === "in_progress" ? (
              <Button variant="primary" onClick={handleAdvance}>
                结束考试
              </Button>
            ) : null}
          </>
        }
      />

      <div className="stat-row" style={{ marginBottom: "var(--sp-4)" }}>
        <Stat label="名单人数" value={session.roster.length} unit="人" hint="发布时物化" />
        <Stat label="已交卷" value={submitted.length} unit="人" hint="含强制交卷" />
        <Stat label="作答中" value={answering.length} unit="人" hint="实时快照" />
        <Stat label="断连中" value={disconnected.length} unit="人" hint="超过心跳阈值" />
        <Stat label="切屏累计" value={focusLossTotal} unit="次" hint="全部考生合计" />
      </div>

      <div className="grid-main">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">场次配置</h2>
            <Badge tone={session.status === "in_progress" ? "ok" : session.status === "cancelled" ? "danger" : "warn"}>
              {SESSION_STATUS_LABEL[session.status]}
            </Badge>
          </div>
          <div className="card-body">
            <dl className="kv">
              <dt>来源试卷</dt>
              <dd>{exam?.name ?? session.paperId}</dd>
              <dt>卷型</dt>
              <dd>{exam?.plum?.mode === "small" ? "小梅花" : exam?.plum?.mode === "large" ? "大梅花" : "标准卷"}</dd>
              <dt>时间窗</dt>
              <dd>
                {session.openAt} 至 {session.closeAt}
              </dd>
              <dt>作答时长</dt>
              <dd>{session.durationMin} 分钟</dd>
              <dt>补考</dt>
              <dd>{session.allowRetake ? "允许重考，成绩取最高分" : "不允许重考"}</dd>
              <dt>名单来源</dt>
              <dd>
                {session.directUserIds && session.directUserIds.length > 0
                  ? `指定考生（${session.directUserIds.length} 人）`
                  : session.scope.length === 0
                    ? "全员开放"
                    : session.scope.map((cid) => classNameOf(cid)).join("、")}
              </dd>
              <dt>考生须知</dt>
              <dd>{session.note || "—"}</dd>
            </dl>
          </div>
          <div className="card-foot">
            <Button variant="danger" onClick={handleCancel} disabled={session.status === "closed"}>
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
                    savePolicy({ maxFocusLoss });
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
                  onClick={() => savePolicy({ onExceeded: "warn" })}
                >
                  警告
                </button>
                <button
                  type="button"
                  className={`chip${policy.onExceeded === "force_submit" ? " is-on" : ""}`}
                  aria-pressed={policy.onExceeded === "force_submit"}
                  onClick={() => savePolicy({ onExceeded: "force_submit" })}
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
                  onChange={(e) => savePolicy({ requireFullscreen: e.target.checked })}
                />
                <span className="checkline-text">要求全屏</span>
              </label>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={policy.disableCopyPaste}
                  onChange={(e) => savePolicy({ disableCopyPaste: e.target.checked })}
                />
                <span className="checkline-text">禁用复制粘贴</span>
              </label>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={policy.disableContextMenu}
                  onChange={(e) => savePolicy({ disableContextMenu: e.target.checked })}
                />
                <span className="checkline-text">禁用右键菜单</span>
              </label>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={policy.watermark}
                  onChange={(e) => savePolicy({ watermark: e.target.checked })}
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
            <span className="text-sm text-3">{session.roster.length} 人 · 发布时物化</span>
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
                </tr>
              </thead>
              <tbody>
                {session.roster.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <Empty title="名单尚未物化" body="发布场次时会按组织标签展开并物化考生名单。" />
                    </td>
                  </tr>
                ) : (
                  session.roster.map((studentId) => {
                    const student = students.find((s) => s.id === studentId);
                    const candidate = candidates.find((c) => c.studentId === studentId);
                    return (
                      <tr key={studentId}>
                        <td className="mono text-xs">{studentId}</td>
                        <td>{student?.name ?? studentId}</td>
                        <td>{student ? classNameOf(student.classId) : "—"}</td>
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
