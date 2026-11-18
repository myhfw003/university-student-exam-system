/* ==========================================================================
   知行测评 · 管理端考试场次
   --------------------------------------------------------------------------
   按设计文档 §2.4 新建（原型无此模块）。
   场次由已发布试卷创建；状态机 scheduled → in_progress → closed，另有 cancelled。

   两条数据通路：
   - mock 模式：本地运维数据 + 本地名单展开；
   - HTTP 模式：真实后端（名单在**发布时物化**，名单组是组织维度标签）。
   ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
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
import {
  cancelAdminSession,
  isBackendEnabled,
  loadOrgTags,
  loadUsers,
  publishAdminSession,
} from "@exam/shared/api";
import type { OrgTag, UserSummary } from "@exam/shared/domain/admin";
import type { ExamSessionStatus } from "@exam/shared/domain/types";
import { Icon } from "@/app/Icon";
import { SessionStatusBadge } from "../shared/bits";
import { submitAdminSession, useAdminSessionList } from "./useAdminSessions";

/** 表单里的日期字符串 → 后端要的 ISO 串（按浏览器本地时区解释）。 */
function toIso(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/** 考试场次列表页。 */
export function ExamSessionListPage() {
  const navigate = useNavigate();
  const remote = isBackendEnabled();
  const exams = useCatalog((state) => state.exams);
  const classes = useCatalog((state) => state.classes);
  const students = useCatalog((state) => state.students);
  const mockSessions = useAdminOps((state) => state.sessions);

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
  // 名单纳入方式（FR-DLV-02）：组织标签 / 指定考生 / 全员开放。
  const [rosterMode, setRosterMode] = useState<"org" | "direct" | "open">("org");
  const [directUserIds, setDirectUserIds] = useState<string[]>([]);
  const [allowRetake, setAllowRetake] = useState(false);
  const [note, setNote] = useState("");

  // HTTP 模式的名单素材：组织维度标签与用户清单。
  const [orgTags, setOrgTags] = useState<OrgTag[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void (async () => {
      const [tags, userList] = await Promise.all([
        loadOrgTags().catch(() => []),
        loadUsers().catch(() => []),
      ]);
      if (cancelled) return;
      setOrgTags(tags);
      setUsers(userList);
    })();
    return () => {
      cancelled = true;
    };
  }, [remote]);

  const publishedExams = useMemo(() => exams.filter((e) => e.published), [exams]);

  const { rows: filtered, refresh } = useAdminSessionList({ status: statusFilter, keyword });

  const handleCreate = () => {
    if (remote) {
      void submitAdminSession({
        paperId,
        name,
        openAt: toIso(openAt),
        closeAt: toIso(closeAt),
        durationMinutes: durationMin,
        participantMode: rosterMode === "org" ? "tags" : rosterMode === "direct" ? "direct" : "open",
        participantTagIds: rosterMode === "org" ? scope : [],
        participantUserIds: rosterMode === "direct" ? directUserIds : [],
        // 卷型规则不给（null）就沿用试卷的——后端 create 的默认行为。
        variantRule: null,
        rules: null,
        note,
      }).then((result) => {
        if (!result.ok) {
          toast.error(result.message ?? "创建失败");
          return;
        }
        toast.ok("场次已创建");
        setDialogOpen(false);
        setName("");
        setNote("");
        refresh();
      });
      return;
    }

    const result = createSession({
      name,
      paperId,
      openAt,
      closeAt,
      durationMin,
      scope: rosterMode === "org" ? scope : [],
      directUserIds: rosterMode === "direct" ? directUserIds : [],
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
    if (remote) {
      void publishAdminSession(id)
        .then(() => {
          toast.ok("场次已发布，名单已物化");
          refresh();
        })
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "发布失败");
        });
      return;
    }

    // 名单按**该场次自己的**纳入方式物化。
    // 这里不能用页面上正在填的表单 scope：否则发布 A 场会把表单里 B 场的名单带出来。
    const target = mockSessions.find((s) => s.id === id);
    if (!target) {
      toast.error("场次不存在");
      return;
    }
    const roster =
      target.directUserIds && target.directUserIds.length > 0
        ? [...target.directUserIds]
        : target.scope.length === 0
          ? students.map((s) => s.id)
          : students.filter((s) => target.scope.includes(s.classId)).map((s) => s.id);
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
    if (remote) {
      const target = pendingCancel;
      setPendingCancel(null);
      void cancelAdminSession(target.id)
        .then(() => {
          toast.ok("场次已取消");
          refresh();
        })
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "取消失败");
        });
      return;
    }

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
            value={filtered.filter((s) => s.status === status).length}
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
                  <th scope="col">场次</th>
                  <th scope="col">来源试卷</th>
                  <th scope="col">时间窗</th>
                  <th scope="col">时长</th>
                  <th scope="col">名单</th>
                  <th scope="col">状态</th>
                  <th scope="col"></th>
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
                  filtered.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div className="strong" style={{ fontWeight: 500 }}>
                          {s.name}
                        </div>
                        <div className="text-xs text-3 mono">{s.id}</div>
                      </td>
                      <td>{s.paperName || getExam(s.paperId)?.name || s.paperId}</td>
                      <td className="text-xs">
                        {s.openAt}
                        <br />
                        {s.closeAt}
                      </td>
                      <td className="num">{s.durationMin}</td>
                      <td className="num">
                        {s.rosterCount === null ? s.rosterModeLabel : `${s.rosterCount} 人`}
                      </td>
                      <td>
                        <SessionStatusBadge status={s.status} />
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
                        ) : null}
                        {!remote && s.status !== "scheduled" ? (
                          <Button size="sm" onClick={() => handleAdvance(s.id)}>
                            推进状态
                          </Button>
                        ) : null}{" "}
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setPendingCancel({ id: s.id, name: s.name })}
                        >
                          取消
                        </Button>
                      </td>
                    </tr>
                  ))
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
            {remote ? (
              <div className="field-hint">
                是否允许重考由**来源试卷**决定，场次不再单独设置。
              </div>
            ) : (
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
            )}
          </Field>
        </div>
        <div style={{ marginTop: "var(--sp-4)" }}>
          <span className="field-label">考试名单</span>
          <div style={{ marginTop: "var(--sp-2)" }}>
            <Segmented
              label="名单纳入方式"
              value={rosterMode}
              onChange={(next) => setRosterMode(next)}
              options={[
                { value: "org" as const, label: "按组织标签" },
                { value: "direct" as const, label: "指定考生" },
                { value: "open" as const, label: "全员开放" },
              ]}
            />
          </div>
          {rosterMode === "org" ? (
            <>
              <div className="row-tight" style={{ marginTop: "var(--sp-2)" }}>
                {remote
                  ? orgTags.map((tag) => {
                      const on = scope.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          className={`chip${on ? " is-on" : ""}`}
                          aria-pressed={on}
                          onClick={() =>
                            setScope((prev) =>
                              prev.includes(tag.id)
                                ? prev.filter((x) => x !== tag.id)
                                : [...prev, tag.id],
                            )
                          }
                        >
                          {tag.name}
                        </button>
                      );
                    })
                  : classes.map((c) => {
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
                              prev.includes(c.id)
                                ? prev.filter((x) => x !== c.id)
                                : [...prev, c.id],
                            )
                          }
                        >
                          {c.name} · {count} 人
                        </button>
                      );
                    })}
              </div>
              <div className="field-hint">
                {remote
                  ? "按组织维度标签（院系 → 专业 → 班级）批量纳入考生。发布时名单会被**物化**为考生列表，之后改标签不影响已生成的名单。"
                  : "按名单组批量纳入考生。发布时名单会被**物化**为考生列表，之后改组织标签不影响已生成的名单。"}
              </div>
            </>
          ) : null}
          {rosterMode === "direct" ? (
            <>
              <div className="row-tight" style={{ marginTop: "var(--sp-2)" }}>
                {remote
                  ? users.map((user) => {
                      const on = directUserIds.includes(user.id);
                      return (
                        <button
                          key={user.id}
                          type="button"
                          className={`chip${on ? " is-on" : ""}`}
                          aria-pressed={on}
                          onClick={() =>
                            setDirectUserIds((prev) =>
                              prev.includes(user.id)
                                ? prev.filter((x) => x !== user.id)
                                : [...prev, user.id],
                            )
                          }
                        >
                          {user.displayName} · {user.username}
                        </button>
                      );
                    })
                  : students.map((s) => {
                      const on = directUserIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={`chip${on ? " is-on" : ""}`}
                          aria-pressed={on}
                          onClick={() =>
                            setDirectUserIds((prev) =>
                              prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                            )
                          }
                        >
                          {s.name} · {s.id}
                        </button>
                      );
                    })}
              </div>
              <div className="field-hint">
                逐个指定考生，可包含社会人士。已选 {directUserIds.length} 人。
              </div>
            </>
          ) : null}
          {rosterMode === "open" ? (
            <div className="field-hint" style={{ marginTop: "var(--sp-2)" }}>
              全员开放：不限定名单，所有已注册用户都能看到该场次并参加。
            </div>
          ) : null}
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
