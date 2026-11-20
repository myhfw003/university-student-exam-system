/* ==========================================================================
   知行测评 · 管理端练习开放单
   --------------------------------------------------------------------------
   按设计文档 §11（docs/design/05-api.md）的「管理端练习管理」新建。
   原型没有这个模块。

   开放单是**独立于练习卷**的聚合：它决定「这份练习开放给谁、开放多久」，
   而次数上限 / 反馈时机 / 错题回流这些练习规则挂在**练习卷**上，
   所以这一页不出现规则字段——规则在组卷向导里配。

   状态机：草稿 → 已上架 → 已下架（已下架与草稿都能重新上架）。
   **下架之后学生立刻看不到这份练习**：archived 不再只是一个只读状态。
   ========================================================================== */

import { useState } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  PageHead,
  Pagination,
  SearchInput,
  Segmented,
  SelectInput,
  TextInput,
  toast,
} from "@exam/shared";
import {
  PRACTICE_ASSIGNMENT_STATUS_LABEL,
  type AdminPracticeAssignment,
  type PracticeAssignmentStatus,
} from "@exam/shared/domain/practice";
import { Icon } from "@/app/Icon";
import { formatMoment, fromLocalInput, toLocalInput } from "./moment";
import {
  archivePracticeAssignmentById,
  publishPracticeAssignmentById,
  savePracticeAssignment,
  submitPracticeAssignment,
  useAdminPracticeAssignmentList,
  useAdminPracticePapers,
  usePracticeScopeTags,
} from "./useAdminPracticeAssignments";

/** 状态徽标的色调。 */
function statusTone(status: PracticeAssignmentStatus): "ok" | "warn" | "neutral" {
  if (status === "published") return "ok";
  if (status === "draft") return "warn";
  return "neutral";
}

/** 练习开放单列表页。 */
export function PracticeAssignmentListPage() {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<"all" | PracticeAssignmentStatus>("all");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);

  const { rows, total, loading, refresh } = useAdminPracticeAssignmentList({
    status,
    keyword,
    page,
    size,
  });
  const { papers } = useAdminPracticePapers();
  const { tags } = usePracticeScopeTags();

  // 表单：新建与编辑共用一套，editing 为 null 表示新建。
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPracticeAssignment | null>(null);
  const [title, setTitle] = useState("");
  const [paperId, setPaperId] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [openAt, setOpenAt] = useState("");
  const [closeAt, setCloseAt] = useState("");

  const [pendingArchive, setPendingArchive] = useState<AdminPracticeAssignment | null>(null);

  const openCreate = () => {
    setEditing(null);
    setTitle("");
    setPaperId("");
    setScope([]);
    setOpenAt("");
    setCloseAt("");
    setDialogOpen(true);
  };

  const openEdit = (row: AdminPracticeAssignment) => {
    setEditing(row);
    setTitle(row.title);
    setPaperId(row.paperId);
    setScope([...row.scopeTagIds]);
    setOpenAt(toLocalInput(row.openAt));
    setCloseAt(toLocalInput(row.closeAt));
    setDialogOpen(true);
  };

  const handleSave = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("练习标题不能为空。");
      return;
    }
    // 练习卷只在新建时选：后端的更新接口没有 paperId，换卷等于换一条开放单。
    if (!editing && !paperId) {
      toast.error("请选择练习卷。");
      return;
    }

    const input = {
      title: trimmed,
      paperId: editing?.paperId ?? paperId,
      scopeTagIds: scope,
      openAt: fromLocalInput(openAt),
      closeAt: fromLocalInput(closeAt),
    };

    const action = editing
      ? savePracticeAssignment(editing.id, {
          title: input.title,
          scopeTagIds: input.scopeTagIds,
          openAt: input.openAt,
          closeAt: input.closeAt,
        })
      : submitPracticeAssignment(input);

    void action.then((result) => {
      if (!result.ok) {
        toast.error(result.message ?? "保存失败");
        return;
      }
      toast.ok(editing ? "开放单已更新" : "开放单已创建（草稿）");
      setDialogOpen(false);
      refresh();
    });
  };

  const handlePublish = (row: AdminPracticeAssignment) => {
    void publishPracticeAssignmentById(row.id).then((result) => {
      if (!result.ok) {
        toast.error(result.message ?? "上架失败");
        return;
      }
      toast.ok("开放单已上架，学生可见");
      refresh();
    });
  };

  const handleArchive = () => {
    if (!pendingArchive) return;
    const target = pendingArchive;
    setPendingArchive(null);
    void archivePracticeAssignmentById(target.id).then((result) => {
      if (!result.ok) {
        toast.error(result.message ?? "下架失败");
        return;
      }
      toast.ok("开放单已下架，学生立即看不到这份练习");
      refresh();
    });
  };

  const toggleScope = (tagId: string) => {
    setScope((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  };

  return (
    <>
      <PageHead
        title="练习开放单"
        sub="开放单决定练习开放给谁、开放多久：学生看到的是已上架且在开放期内的开放单。次数上限、反馈时机与错题回流是练习卷的规则，在组卷向导里配。"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Icon name="plus" />
            新建开放单
          </Button>
        }
      />

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">开放单清单</h2>
          <span className="text-sm text-3">
            {loading ? "加载中…" : `共 ${total} 条`}
          </span>
        </div>
        <div className="card-body">
          <div className="row">
            <Segmented
              label="状态筛选"
              value={status}
              onChange={(next) => {
                setStatus(next);
                setPage(1);
              }}
              options={[
                { value: "all" as const, label: "全部" },
                ...(["draft", "published", "archived"] as const).map((code) => ({
                  value: code,
                  label: PRACTICE_ASSIGNMENT_STATUS_LABEL[code],
                })),
              ]}
            />
            <SearchInput
              label="搜索开放单"
              value={keyword}
              placeholder="搜索开放单标题"
              onSearch={(value) => {
                setKeyword(value);
                setPage(1);
              }}
              onChange={(value) => {
                setKeyword(value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <div className="card-body is-flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">开放单</th>
                  <th scope="col">练习卷</th>
                  <th scope="col">题量 · 总分</th>
                  <th scope="col">开放范围</th>
                  <th scope="col">开放期</th>
                  <th scope="col">状态</th>
                  <th scope="col">次数</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty">
                        <span className="empty-title">没有符合条件的开放单</span>
                        <span className="empty-body">
                          点击右上角新建开放单，挂到一份已发布的练习卷上。
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{row.title}</div>
                        <div className="text-xs text-3 mono">{row.id}</div>
                      </td>
                      <td>{row.paperName || row.paperId}</td>
                      <td className="num">
                        {row.questionCount} 题 · {row.totalScore} 分
                      </td>
                      <td>
                        {row.scopeTagNames.length === 0 ? (
                          <span className="text-3">全员开放</span>
                        ) : (
                          <div className="row-tight">
                            {row.scopeTagNames.map((name) => (
                              <span key={name} className="chip is-on" aria-hidden="true">
                                {name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="text-xs">
                        {formatMoment(row.openAt)}
                        <br />
                        {formatMoment(row.closeAt)}
                      </td>
                      <td>
                        <Badge tone={statusTone(row.status)}>{row.statusLabel}</Badge>
                      </td>
                      <td className="num">{row.attemptCount}</td>
                      <td className="col-actions">
                        {row.status !== "published" ? (
                          <Button size="sm" variant="primary" onClick={() => handlePublish(row)}>
                            上架
                          </Button>
                        ) : null}{" "}
                        {row.status === "published" ? (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setPendingArchive(row)}
                          >
                            下架
                          </Button>
                        ) : null}{" "}
                        <Button size="sm" onClick={() => openEdit(row)}>
                          编辑
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card-body">
          <Pagination
            page={page}
            pageSize={size}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setSize(next);
              setPage(1);
            }}
            label="开放单分页"
          />
        </div>
      </section>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "编辑开放单" : "新建练习开放单"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleSave}>
              {editing ? "保存" : "创建"}
            </Button>
          </>
        }
      >
        <Field label="开放单标题" required htmlFor="pa-title">
          <TextInput
            id="pa-title"
            value={title}
            placeholder="例如 数据结构 · 树与查找专题"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>

        <div style={{ marginTop: "var(--sp-4)" }}>
          <Field
            label="练习卷"
            required={!editing}
            htmlFor="pa-paper"
            hint={
              editing
                ? "已上架的开放单不能换练习卷——换卷等于换一条开放单。"
                : "只列已发布的练习卷：没发布的练习卷没有卷面快照，学生做了也做不了。"
            }
          >
            <SelectInput
              id="pa-paper"
              value={paperId}
              disabled={editing !== null}
              onChange={(event) => setPaperId(event.target.value)}
            >
              <option value="">请选择已发布的练习卷</option>
              {papers.map((paper) => (
                <option key={paper.id} value={paper.id}>
                  {paper.name}（{paper.questionCount} 题 · {paper.totalScore} 分）
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>

        <div style={{ marginTop: "var(--sp-4)" }}>
          <span className="field-label">开放范围</span>
          <div className="row-tight" style={{ marginTop: "var(--sp-2)" }}>
            {tags.map((tag) => {
              const on = scope.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={`chip${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => toggleScope(tag.id)}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
          <div className="field-hint">
            按组织维度标签（院系 → 专业 → 班级）开放；一个都不选就是全员开放。
            已选 {scope.length} 个。
          </div>
        </div>

        <div className="grid-2" style={{ marginTop: "var(--sp-4)" }}>
          <Field label="开放开始" htmlFor="pa-open" hint="留空表示不限。">
            <TextInput
              id="pa-open"
              type="datetime-local"
              value={openAt}
              onChange={(event) => setOpenAt(event.target.value)}
            />
          </Field>
          <Field label="开放结束" htmlFor="pa-close" hint="留空表示不限。">
            <TextInput
              id="pa-close"
              type="datetime-local"
              value={closeAt}
              onChange={(event) => setCloseAt(event.target.value)}
            />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={pendingArchive !== null}
        title="下架开放单"
        message={`下架「${pendingArchive?.title ?? ""}」后，学生立刻看不到这份练习（已经做过的记录不受影响）。之后可以重新上架。`}
        confirmText="确认下架"
        confirmVariant="danger"
        onCancel={() => setPendingArchive(null)}
        onConfirm={handleArchive}
      />
    </>
  );
}
