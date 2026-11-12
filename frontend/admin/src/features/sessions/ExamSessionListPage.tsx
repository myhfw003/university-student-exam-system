/* ==========================================================================
   知行测评 · 管理端考试场次
   --------------------------------------------------------------------------
   按设计文档 §2.4 新建（原型无此模块）。
   场次由已发布试卷创建；状态机 scheduled → in_progress → closed，另有 cancelled。
   ========================================================================== */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  PageHead,
  SearchInput,
  Segmented,
  SelectInput,
  Stat,
  TextArea,
  TextInput,
  toast,
} from "@exam/shared";
import {
  SESSION_STATUS_LABEL,
  advanceSession,
  cancelSession,
  createSession,
  publishSession,
  useAdminOps,
  writeAudit,
} from "@exam/shared/mock/adminOps";
import { getExam, useCatalog } from "@exam/shared/mock/catalog";
import type { ExamSessionStatus } from "@exam/shared/domain/types";
import { Icon } from "@/app/Icon";

const STATUS_TONE: Record<ExamSessionStatus, "ok" | "warn" | "neutral" | "danger"> = {
  scheduled: "warn",
  in_progress: "ok",
  closed: "neutral",
  cancelled: "danger",
};

/** 考试场次列表页。 */
export function ExamSessionListPage() {
  const navigate = useNavigate();
  const sessions = useAdminOps((state) => state.sessions);
  const exams = useCatalog((state) => state.exams);
  const classes = useCatalog((state) => state.classes);
  const students = useCatalog((state) => state.students);

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ExamSessionStatus>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingCancel, setPendingCancel] = useState<{ id: string; name: string } | null>(null);

  // 新建表单。
  const [name, setName] = useState("");
  const [paperId, setPaperId] = useState("");
  const [openAt, setOpenAt] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [durationMin, setDurationMin] = useState(90);
  const [scope, setScope] = useState<string[]>([]);
  const [allowRetake, setAllowRetake] = useState(false);
  const [note, setNote] = useState("");

  const publishedExams = useMemo(() => exams.filter((e) => e.published), [exams]);

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (!`${s.name} ${s.id}`.toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [sessions, keyword, statusFilter]);

  const handleCreate = () => {
    const result = createSession({
      name,
      paperId,
      openAt,
      closeAt,
      durationMin,
      scope,
      allowRetake,
      note,
    });
    if (!result.ok || !result.session) {
      toast.error(result.message ?? "创建失败");
      return;
    }
    writeAudit({
      operator: "陈砚之",
      action: "session.publish",
      targetType: "exam_session",
      targetId: result.session.id,
      summary: `创建场次「${result.session.name}」`,
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    });
    toast.ok("场次已创建");
    setDialogOpen(false);
    setName("");
    setNote("");
  };

  const handlePublish = (id: string, sessionName: string) => {
    // 按组织标签展开并物化名单。
    const roster = students.filter((s) => scope.length === 0 || scope.includes(s.classId)).map((s) => s.id);
    const result = publishSession(id, roster);
    if (!result.ok) {
      toast.error(result.message ?? "发布失败");
      return;
    }
    writeAudit({
      operator: "陈砚之",
      action: "session.publish",
      targetType: "exam_session",
      targetId: id,
      summary: `发布场次「${sessionName}」，物化名单 ${result.count} 人`,
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    });
    toast.ok(`场次已发布，物化名单 ${result.count} 人`);
  };

  const handleAdvance = (id: string) => {
    const result = advanceSession(id);
    if (!result.ok) {
      toast.error(result.message ?? "状态流转被拒绝");
      return;
    }
    toast.ok(`场次状态已推进为「${SESSION_STATUS_LABEL[result.status!]}」`);
  };

  const handleCancel = () => {
    if (!pendingCancel) return;
    const result = cancelSession(pendingCancel.id, "管理员取消");
    if (!result.ok) {
      toast.error(result.message ?? "取消失败");
      setPendingCancel(null);
      return;
    }
    writeAudit({
      operator: "陈砚之",
      action: "session.cancel",
      targetType: "exam_session",
      targetId: pendingCancel.id,
      summary: `取消场次「${pendingCancel.name}」`,
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    });
    toast.ok("场次已取消");
    setPendingCancel(null);
  };

  return (
    <>
      <PageHead
        title="考试场次"
        sub="场次由已发布试卷创建，含时间窗、时长、卷型、名单与考生须知。状态机：未开始 → 进行中 → 已结束，另有已取消。"
        actions={
          <Button variant="primary" onClick={() => setDialogOpen(true)}>
            <Icon name="plus" />
            新建场次
          </Button>
        }
      />

      <div className="stat-row" style={{ marginBottom: "var(--sp-4)" }}>
        {(["scheduled", "in_progress", "closed", "cancelled"] as const).map((status) => (
          <Stat
            key={status}
            label={SESSION_STATUS_LABEL[status]}
            value={sessions.filter((s) => s.status === status).length}
            unit="场"
            hint={
              status === "in_progress"
                ? "监考大屏实时跟踪"
                : status === "scheduled"
                  ? "等待开考"
                  : status === "closed"
                    ? "成绩待发布"
                    : "已终止"
            }
          />
        ))}
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">场次清单</h2>
          <span className="text-sm text-3">{filtered.length} 场</span>
        </div>
        <div className="card-body">
          <div className="row">
            <Segmented
              label="状态筛选"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all" as const, label: "全部" },
                ...(["scheduled", "in_progress", "closed", "cancelled"] as const).map((s) => ({
                  value: s,
                  label: SESSION_STATUS_LABEL[s],
                })),
              ]}
            />
            <SearchInput
              label="搜索场次"
              value={keyword}
              placeholder="搜索场次名称或编号"
              onSearch={setKeyword}
              onChange={setKeyword}
            />
          </div>
        </div>
        <div className="card-body is-flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>场次</th>
                  <th>来源试卷</th>
                  <th>时间窗</th>
                  <th>时长</th>
                  <th>名单</th>
                  <th>状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty">
                        <span className="empty-title">暂无场次</span>
                        <span className="empty-body">点击右上角新建场次。</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((s) => {
                    const exam = getExam(s.paperId);
                    return (
                      <tr key={s.id}>
                        <td>
                          <div className="strong" style={{ fontWeight: 500 }}>
                            {s.name}
                          </div>
                          <div className="text-xs text-3 mono">{s.id}</div>
                        </td>
                        <td>{exam?.name ?? s.paperId}</td>
                        <td className="text-xs">
                          {s.openAt}
                          <br />
                          {s.closeAt}
                        </td>
                        <td className="num">{s.durationMin}</td>
                        <td className="num">{s.roster.length} 人</td>
                        <td>
                          <Badge tone={STATUS_TONE[s.status]}>
                            {SESSION_STATUS_LABEL[s.status]}
                          </Badge>
                        </td>
                        <td className="col-actions">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => navigate(`/exam-sessions/${s.id}`)}
                          >
                            详情
                          </Button>{" "}
                          {s.status === "in_progress" ? (
                            <Button size="sm" onClick={() => navigate(`/monitoring/${s.id}`)}>
                              监考
                            </Button>
                          ) : null}{" "}
                          {s.status === "scheduled" ? (
                            <Button size="sm" onClick={() => handlePublish(s.id, s.name)}>
                              发布
                            </Button>
                          ) : (
                            <Button size="sm" onClick={() => handleAdvance(s.id)}>
                              推进状态
                            </Button>
                          )}{" "}
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setPendingCancel({ id: s.id, name: s.name })}
                          >
                            取消
                          </Button>
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

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="新建考试场次"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleCreate}>
              创建
            </Button>
          </>
        }
      >
        <Field label="场次名称" required htmlFor="sess-name">
          <TextInput
            id="sess-name"
            value={name}
            placeholder="例如 计算机网络期中考试 · 第 2 场"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div style={{ marginTop: "var(--sp-4)" }}>
          <Field label="来源试卷" required hint="仅已发布的试卷可作为场次来源。" htmlFor="sess-paper">
            <SelectInput
              id="sess-paper"
              value={paperId}
              onChange={(e) => setPaperId(e.target.value)}
            >
              <option value="">请选择已发布试卷</option>
              {publishedExams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <div className="grid-2" style={{ marginTop: "var(--sp-4)" }}>
          <Field label="开考时间" htmlFor="sess-open">
            <TextInput
              id="sess-open"
              value={openAt}
              placeholder="2026-11-20 08:30"
              onChange={(e) => setOpenAt(e.target.value)}
            />
          </Field>
          <Field label="结束时间" htmlFor="sess-close">
            <TextInput
              id="sess-close"
              value={closeAt}
              placeholder="2026-11-20 12:00"
              onChange={(e) => setCloseAt(e.target.value)}
            />
          </Field>
        </div>
        <div className="grid-2" style={{ marginTop: "var(--sp-4)" }}>
          <Field label="作答时长（分钟）" htmlFor="sess-duration">
            <TextInput
              id="sess-duration"
              type="number"
              min={1}
              max={300}
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="补考策略" htmlFor="sess-retake">
            <label className="checkline">
              <input
                id="sess-retake"
                type="checkbox"
                checked={allowRetake}
                onChange={(e) => setAllowRetake(e.target.checked)}
              />
              <span className="checkline-text">
                允许重考
                <span className="checkline-hint">重考时生成新的作答记录，成绩取最高分。</span>
              </span>
            </label>
          </Field>
        </div>
        <div style={{ marginTop: "var(--sp-4)" }}>
          <span className="field-label">考试名单</span>
          <div className="row-tight" style={{ marginTop: "var(--sp-2)" }}>
            {classes.map((c) => {
              const on = scope.includes(c.id);
              const count = students.filter((s) => s.classId === c.id).length;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`chip${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  onClick={() =>
                    setScope((prev) =>
                      prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                    )
                  }
                >
                  {c.name} · {count} 人
                </button>
              );
            })}
          </div>
          <div className="field-hint">
            不选任何名单组即为全员开放。发布时名单会被**物化**为考生列表，之后改组织标签不影响已生成的名单。
          </div>
        </div>
        <div style={{ marginTop: "var(--sp-4)" }}>
          <Field label="考生须知" htmlFor="sess-note">
            <TextArea
              id="sess-note"
              value={note}
              placeholder="面向考生的说明与注意事项"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={pendingCancel !== null}
        title="取消场次"
        message={`取消「${pendingCancel?.name ?? ""}」后，答题端将无法进入本场考试。已交卷的成绩不受影响。`}
        confirmText="确认取消"
        confirmVariant="danger"
        onCancel={() => setPendingCancel(null)}
        onConfirm={handleCancel}
      />
    </>
  );
}
