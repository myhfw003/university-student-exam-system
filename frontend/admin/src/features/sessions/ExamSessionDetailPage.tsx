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
  Dialog,
  Empty,
  Field,
  PageHead,
  SearchInput,
  Stat,
  TextInput,
  downloadCsv,
  toast,
} from "@exam/shared";
import { isBackendEnabled, type ExamParticipantImportResult } from "@exam/shared/api";
import { SESSION_STATUS_LABEL } from "@exam/shared/mock/adminOps";
import { Icon } from "@/app/Icon";
import { useProctorFeed } from "../monitoring/useProctorFeed";
import { usePeopleCandidates } from "../shared/usePeopleCandidates";
import { useAdminSessionDetail } from "./useAdminSessions";

/** 场次详情页。 */
export function ExamSessionDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const view = useAdminSessionDetail(id);
  const feed = useProctorFeed(id);

  const [maxFocusLoss, setMaxFocusLoss] = useState<number | null>(null);

  // 名单 CSV 导入（真实后端模式）。
  const remote = isBackendEnabled();
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ExamParticipantImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // 场次负责人指派（真实后端模式）。
  const [assignOpen, setAssignOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [assignKeywordRaw, setAssignKeywordRaw] = useState("");
  const [assignSaving, setAssignSaving] = useState(false);
  const assignees = usePeopleCandidates(assignOpen);

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

  /** 名单 CSV 导入：导入后名单口径切到「指定考生」。 */
  const handleImport = async () => {
    if (!importFile) {
      toast.error("请先选择名单文件");
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const result = await view.importParticipants(importFile);
      setImportResult(result);
      toast.ok(
        `名单已导入：${result.imported} 人` +
          (result.skipped.length > 0 ? `，${result.skipped.length} 行被跳过` : ""),
      );
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
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

  /** 打开指派对话框：以当前指派为初始勾选。 */
  const openAssign = () => {
    setPicked(view.assignments.map((entry) => entry.userId));
    setAssignKeywordRaw("");
    setAssignOpen(true);
  };

  /** 保存指派（覆盖式：没勾的人会被移除）。 */
  const handleSaveAssignments = async () => {
    setAssignSaving(true);
    try {
      await view.saveAssignments(picked);
      toast.ok(`已指派 ${picked.length} 人负责这场考试`);
      setAssignOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setAssignSaving(false);
    }
  };

  // 候选按账号或姓名过滤。
  const assignKeyword = assignKeywordRaw.trim().toLowerCase();
  const visibleCandidates = assignees.candidates.filter(
    (candidate) =>
      !assignKeyword ||
      `${candidate.account} ${candidate.name}`.toLowerCase().includes(assignKeyword),
  );

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

      {/* 场次负责人（阅卷教师 / 监考人员）：真实后端模式才有这个概念。 */}
      {remote ? (
        <section className="card" style={{ marginTop: "var(--sp-4)" }}>
          <div className="card-head">
            <h2 className="card-title">负责教师</h2>
            <div className="row-tight">
              <span className="text-sm text-3">{view.assignments.length} 人</span>
              <Button size="sm" onClick={openAssign}>
                指派教师
              </Button>
            </div>
          </div>
          <div className="card-body">
            {view.assignments.length === 0 ? (
              <Empty
                title="尚未指派负责人"
                body="指派后，被指派的教师看得到这场考试的全部作答、成绩与监考数据。"
              />
            ) : (
              <ul className="rule-list">
                {view.assignments.map((entry) => (
                  <li key={entry.userId}>
                    {entry.displayName || entry.username} ·{" "}
                    <span className="mono text-xs">{entry.username}</span>
                  </li>
                ))}
              </ul>
            )}
            <Callout tone="info" title="指派不授予权限">
              指派只界定「谁负责这场考试」。被指派的人仍要自己有阅卷或监考的权限点，
              才能看到这场考试的数据。
            </Callout>
          </div>
        </section>
      ) : null}

      <section className="card" style={{ marginTop: "var(--sp-4)" }}>
        <div className="card-head">
          <h2 className="card-title">考生名单</h2>
          <div className="row-tight">
            <span className="text-sm text-3">{view.roster.length} 人 · 发布时物化</span>
            {remote && view.status === "scheduled" ? (
              <Button
                size="sm"
                onClick={() => {
                  setImportResult(null);
                  setImportError(null);
                  setImportOpen(true);
                }}
              >
                导入名单
              </Button>
            ) : null}
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

      {/* 名单 CSV 导入。 */}
      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="导入考生名单"
        footer={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(false)}>
              关闭
            </Button>
            <Button
              variant="primary"
              disabled={importFile === null || importing || importResult !== null}
              onClick={() => void handleImport()}
            >
              {importing ? "导入中…" : "确认导入"}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Callout tone="info" title="名单 CSV 列定义">
            与「用户」里的名单同一份文件：**账号**（学号）与**姓名**两列必填。
            导入的是**已有账号**：账号不存在的行会被跳过并给出原因，先把账号建好再导。
            导入后名单口径切到「指定考生」——名单就是这批账号。
          </Callout>

          <Field
            htmlFor="session-roster-file"
            label="名单文件"
            hint="支持 .csv（UTF-8 / GBK）。列按表头名自动匹配。"
          >
            <input
              id="session-roster-file"
              className="input"
              type="file"
              accept=".csv,.txt"
              onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
            />
          </Field>

          {importError ? (
            <Callout tone="danger" title="导入失败">
              {importError}
            </Callout>
          ) : null}

          {importResult ? (
            <Callout
              tone={importResult.skipped.length > 0 ? "warn" : "ok"}
              title={`导入完成：成功 ${importResult.imported} 人，跳过 ${importResult.skipped.length} 行`}
            >
              名单口径现在是「{importResult.participantModeLabel}」，共{" "}
              {importResult.participantCount} 人。发布场次时按这份名单物化。
              {importResult.skipped.length > 0 ? (
                <ul className="rule-list" style={{ marginTop: "var(--sp-3)" }}>
                  {importResult.skipped.map((failure) => (
                    <li key={`${failure.rowNumber}-${failure.account}`}>
                      第 {failure.rowNumber} 行 · {failure.account || "（无账号）"} ·{" "}
                      {failure.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Callout>
          ) : null}
        </div>
      </Dialog>

      {/* 场次负责人指派。 */}
      <Dialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="指派负责教师"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssignOpen(false)}>
              关闭
            </Button>
            <Button
              variant="primary"
              disabled={assignSaving}
              onClick={() => void handleSaveAssignments()}
            >
              {assignSaving ? "保存中…" : "保存指派"}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Callout tone="info" title="覆盖式保存">
            保存后，没勾选的人会被移出指派名单。指派只界定「谁负责这场考试」，不授予权限。
          </Callout>

          <SearchInput
            id="assign-keyword"
            label="搜索教师"
            placeholder="按账号或姓名过滤"
            value={assignKeywordRaw}
            onChange={setAssignKeywordRaw}
            onSearch={setAssignKeywordRaw}
          />

          {assignees.error ? (
            <Callout tone="danger" title="候选教师加载失败">
              {assignees.error}
            </Callout>
          ) : null}

          {assignees.loading ? (
            <p className="text-3 text-sm">加载候选教师…</p>
          ) : visibleCandidates.length === 0 ? (
            <Empty title="没有可选的教师" body="候选是除学生与社会人士以外的账号。" />
          ) : (
            <div className="stack" style={{ maxHeight: "320px", overflowY: "auto" }}>
              {visibleCandidates.map((candidate) => (
                <label key={candidate.id} className="checkline">
                  <input
                    type="checkbox"
                    checked={picked.includes(candidate.id)}
                    onChange={(event) =>
                      setPicked((current) =>
                        event.target.checked
                          ? [...current, candidate.id]
                          : current.filter((id) => id !== candidate.id),
                      )
                    }
                  />
                  <span className="checkline-text">
                    {candidate.name} · <span className="mono text-xs">{candidate.account}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
