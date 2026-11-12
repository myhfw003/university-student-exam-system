/* ==========================================================================
   知行测评 · 管理端题库清单
   --------------------------------------------------------------------------
   对应原型 admin.banks。题库是内容的组织容器；进入工作台管理题目与候选题。
   ========================================================================== */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  PageHead,
  TextArea,
  TextInput,
  toast,
} from "@exam/shared";
import {
  bankStats,
  removeBank,
  upsertBank,
  useCatalog,
} from "@exam/shared/mock/catalog";
import type { Bank } from "@exam/shared/domain/types";
import { Icon } from "@/app/Icon";
import { TagChips } from "../shared/bits";
import { TagPicker } from "../shared/TagPicker";

/** 题库清单页。 */
export function BanksPage() {
  const navigate = useNavigate();
  const banks = useCatalog((state) => state.banks);
  const questions = useCatalog((state) => state.questions);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Bank | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Bank | null>(null);

  const allStats = bankStats("__all__");

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDesc("");
    setTags([]);
    setDialogOpen(true);
  };

  const openEdit = (bank: Bank) => {
    setEditing(bank);
    setName(bank.name);
    setDesc(bank.desc ?? "");
    setTags(bank.tags);
    setDialogOpen(true);
  };

  const handleSave = () => {
    const result = upsertBank({
      ...(editing ? { id: editing.id } : {}),
      name,
      desc,
      tags,
      questionIds: editing?.questionIds ?? [],
    });
    if (!result.ok) {
      toast.error(result.message ?? "保存失败");
      return;
    }
    toast.ok(editing ? "题库已更新" : "题库已创建");
    setDialogOpen(false);
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    const result = removeBank(pendingDelete.id);
    if (!result.ok) {
      toast.error(result.message ?? "删除失败");
      setPendingDelete(null);
      return;
    }
    toast.ok("题库已删除");
    setPendingDelete(null);
  };

  return (
    <>
      <PageHead
        title="题库"
        sub="题库是内容的组织容器。进入题库工作台可管理题目状态、审核候选题，并通过导入或 AI 生成补充内容。"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Icon name="plus" />
            新建题库
          </Button>
        }
      />

      <section className="card" style={{ marginBottom: "var(--sp-4)" }}>
        <div className="card-body">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="strong" style={{ fontWeight: 600 }}>
                全部题库
              </div>
              <div className="text-sm text-3">
                跨库查看全部 {questions.length} 道题目（已发布 {allStats.published} / 草稿{" "}
                {allStats.draft} / 已停用 {allStats.disabled}）
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => navigate("/banks/__all__?tab=questions")}
            >
              进入工作台
            </Button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">题库清单</h2>
          <span className="text-sm text-3">{banks.length} 个题库</span>
        </div>
        <div className="card-body is-flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>题库</th>
                  <th>标签</th>
                  <th>已发布</th>
                  <th>草稿</th>
                  <th>已停用</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {banks.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty">
                        <span className="empty-title">暂无题库</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  banks.map((bank) => {
                    const stats = bankStats(bank.id);
                    return (
                      <tr key={bank.id}>
                        <td>
                          <div className="strong" style={{ fontWeight: 500 }}>
                            {bank.name}
                          </div>
                          <div className="text-xs text-3">{bank.desc || "—"}</div>
                        </td>
                        <td>
                          {bank.tags.length > 0 ? (
                            <TagChips tags={bank.tags} limit={3} />
                          ) : (
                            <span className="text-3 text-sm">—</span>
                          )}
                        </td>
                        <td className="num">{stats.published}</td>
                        <td className="num">
                          {stats.draft > 0 ? (
                            <span className="badge badge-warn">{stats.draft}</span>
                          ) : (
                            <span className="text-3">0</span>
                          )}
                        </td>
                        <td className="num">
                          {stats.disabled > 0 ? (
                            <span className="badge badge-neutral">{stats.disabled}</span>
                          ) : (
                            <span className="text-3">0</span>
                          )}
                        </td>
                        <td className="col-actions">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => navigate(`/banks/${bank.id}`)}
                          >
                            工作台
                          </Button>{" "}
                          <Button size="sm" onClick={() => openEdit(bank)}>
                            编辑
                          </Button>{" "}
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setPendingDelete(bank)}
                          >
                            删除
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
        title={editing ? `编辑题库 · ${editing.name}` : "新建题库"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleSave}>
              保存
            </Button>
          </>
        }
      >
        <Field label="题库名称" required htmlFor="bk-name">
          <TextInput
            id="bk-name"
            value={name}
            placeholder="例如 高等数学基础题库"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div style={{ marginTop: "var(--sp-4)" }}>
          <Field label="题库说明" htmlFor="bk-desc">
            <TextArea
              id="bk-desc"
              value={desc}
              placeholder="说明题库的覆盖范围与使用场景"
              onChange={(event) => setDesc(event.target.value)}
            />
          </Field>
        </div>
        <div style={{ marginTop: "var(--sp-4)" }}>
          <div className="field-label">标签</div>
          <TagPicker
            selected={tags}
            onToggle={(tagId) =>
              setTags((prev) =>
                prev.includes(tagId)
                  ? prev.filter((t) => t !== tagId)
                  : [...prev, tagId],
              )
            }
          />
          <div className="field-hint">
            标签用于把题库接入领域 / 知识点 / 能力等维度，最多 5 个。
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除题库"
        message={`删除「${pendingDelete?.name ?? ""}」后，题库内的题目仍保留在题库列表中，但不再归属该题库。`}
        confirmText="确认删除"
        confirmVariant="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />
    </>
  );
}
