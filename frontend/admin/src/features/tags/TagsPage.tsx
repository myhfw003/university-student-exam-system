/* ==========================================================================
   知行测评 · 管理端标签管理
   --------------------------------------------------------------------------
   对应原型 admin.tags。标签是全系统的组织轴：题库、题目、试卷与练习都挂标签。
   删除标签会级联解除挂载，对象本身保留。
   ========================================================================== */

import { useState } from "react";
import {
  Button,
  Callout,
  ConfirmDialog,
  Dialog,
  Field,
  PageHead,
  SelectInput,
  Stat,
  TextInput,
  toast,
} from "@exam/shared";
import {
  MAX_TAGS,
  TAG_GROUP_LABEL,
  TAG_GROUP_ORDER,
  createTag,
  removeTag,
  updateTag,
  usageOf,
  useCatalog,
} from "@exam/shared/mock/catalog";
import type { Tag, TagGroup } from "@exam/shared/domain/types";
import { Icon } from "@/app/Icon";

/** 标签管理页。 */
export function TagsPage() {
  const tags = useCatalog((state) => state.tags);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [group, setGroup] = useState<TagGroup>("domain");
  const [pendingDelete, setPendingDelete] = useState<Tag | null>(null);

  const totalUsage = tags.reduce((sum, tag) => sum + usageOf(tag.id).total, 0);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setGroup("domain");
    setDialogOpen(true);
  };

  const openEdit = (tag: Tag) => {
    setEditing(tag);
    setName(tag.name);
    setGroup(tag.group);
    setDialogOpen(true);
  };

  const handleSave = () => {
    const result = editing
      ? updateTag(editing.id, { name, group })
      : createTag({ name, group });
    if (!result.ok) {
      toast.error(result.message ?? "保存失败");
      return;
    }
    toast.ok(editing ? "标签已更新" : "标签已创建");
    setDialogOpen(false);
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    const result = removeTag(pendingDelete.id);
    if (!result.ok) {
      toast.error(result.message ?? "删除失败");
      setPendingDelete(null);
      return;
    }
    toast.ok(`已删除标签「${pendingDelete.name}」并解除 ${usageOf(pendingDelete.id).total} 处挂载`);
    setPendingDelete(null);
  };

  return (
    <>
      <PageHead
        title="标签"
        sub={`标签是本系统的组织轴：题库、题目、试卷与练习都通过标签关联。共 ${tags.length} 个标签，当前累计挂载 ${totalUsage} 次；单个对象最多挂载 ${MAX_TAGS} 个标签。`}
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Icon name="plus" />
            新建标签
          </Button>
        }
      />

      <div className="stat-row" style={{ marginBottom: "var(--sp-5)" }}>
        {TAG_GROUP_ORDER.map((g) => (
          <Stat
            key={g}
            label={TAG_GROUP_LABEL[g]}
            value={tags.filter((t) => t.group === g).length}
            unit="个"
            hint="该分组下的标签词条"
          />
        ))}
      </div>

      {TAG_GROUP_ORDER.map((groupKey) => {
        const list = tags.filter((t) => t.group === groupKey);
        return (
          <section className="card" key={groupKey} style={{ marginBottom: "var(--sp-4)" }}>
            <div className="card-head">
              <h2 className="card-title">{TAG_GROUP_LABEL[groupKey]}</h2>
              <span className="text-sm text-3">{list.length} 个标签</span>
            </div>
            <div className="card-body is-flush">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">标签</th>
                      <th scope="col">题目</th>
                      <th scope="col">题库</th>
                      <th scope="col">试卷</th>
                      <th scope="col">练习</th>
                      <th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.length === 0 ? (
                      <tr>
                        <td colSpan={6}>
                          <div className="empty">
                            <span className="empty-title">该分组暂无标签</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      list.map((tag) => {
                        const usage = usageOf(tag.id);
                        return (
                          <tr key={tag.id}>
                            <td>
                              <div className="strong" style={{ fontWeight: 500 }}>
                                {tag.name}
                              </div>
                              <div className="text-xs text-3 mono">{tag.id}</div>
                            </td>
                            <td className="num">{usage.questions}</td>
                            <td className="num">{usage.banks}</td>
                            <td className="num">{usage.exams}</td>
                            <td className="num">{usage.practices}</td>
                            <td className="col-actions">
                              <Button size="sm" onClick={() => openEdit(tag)}>
                                编辑
                              </Button>{" "}
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => setPendingDelete(tag)}
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
        );
      })}

      <Callout icon={<Icon name="info" />} title="删除标签会级联解除挂载">
        删除标签后，题库、题目、试卷与练习上对应的挂载会一并解除，对象本身保留。难度标签的名称与等级对应：基础 / 中等 / 较难。
      </Callout>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? `编辑标签 · ${editing.name}` : "新建标签"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleSave}>
              保存标签
            </Button>
          </>
        }
      >
        <Field label="标签名称" required hint="同一分组内名称不可重复。" htmlFor="tg-name">
          <TextInput
            id="tg-name"
            value={name}
            placeholder="例如 极限与连续"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div style={{ marginTop: "var(--sp-4)" }}>
          <Field
            htmlFor="tg-group"
            label="所属分组"
            hint="分组决定标签在列表与筛选器中的位置：领域用于主标识，知识点用于错题聚合，能力用于能力画像，难度用于难度层级。"
          >
            <SelectInput
              id="tg-group"
              value={group}
              onChange={(event) => setGroup(event.target.value as TagGroup)}
            >
              {TAG_GROUP_ORDER.map((g) => (
                <option key={g} value={g}>
                  {TAG_GROUP_LABEL[g]}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        {editing ? (
          <p className="section-note" style={{ marginTop: "var(--sp-4)" }}>
            当前引用：{usageOf(editing.id).total} 次（题目 {usageOf(editing.id).questions} / 题库{" "}
            {usageOf(editing.id).banks} / 试卷 {usageOf(editing.id).exams} / 练习{" "}
            {usageOf(editing.id).practices}）
          </p>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除标签"
        message={
          pendingDelete
            ? `将删除标签「${pendingDelete.name}」，并解除其在 ${usageOf(pendingDelete.id).total} 处挂载（题目 ${usageOf(pendingDelete.id).questions} / 题库 ${usageOf(pendingDelete.id).banks} / 试卷 ${usageOf(pendingDelete.id).exams} / 练习 ${usageOf(pendingDelete.id).practices}）。对象本身保留，操作不可撤销。`
            : ""
        }
        confirmText="确认删除"
        confirmVariant="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />
    </>
  );
}
