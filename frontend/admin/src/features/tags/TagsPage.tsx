/* ==========================================================================
   知行测评 · 管理端标签管理
   --------------------------------------------------------------------------
   对应原型 admin.tags。标签是全系统的组织轴：题库、题目、试卷与练习都挂标签。
   删除标签会级联解除挂载，对象本身保留。

   数据通路见 `useAdminTags.ts`：真实后端模式下，编码唯一且不可改，
   挂载统计只有总数（后端的题库与练习没有标签挂载）。
   ========================================================================== */

import { useMemo, useState } from "react";
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
import { isBackendEnabled } from "@exam/shared/api";
import { TAG_GROUP_LABEL, TAG_GROUP_ORDER, MAX_TAGS } from "@exam/shared/mock/catalog";
import type { TagGroup } from "@exam/shared/domain/types";
import { Icon } from "@/app/Icon";
import { deriveTagCode, useAdminTags, type TagRow } from "./useAdminTags";

/** 标签管理页。 */
export function TagsPage() {
  const remote = isBackendEnabled();
  const { tags, create, update, remove, descendants } = useAdminTags();

  const [editing, setEditing] = useState<TagRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [group, setGroup] = useState<TagGroup>("domain");
  const [code, setCode] = useState("");
  const [parentId, setParentId] = useState("");
  const [pendingDelete, setPendingDelete] = useState<TagRow | null>(null);
  /** 正在看子标签的标签；null = 没打开。 */
  const [subtreeTag, setSubtreeTag] = useState<TagRow | null>(null);
  const [subtreeRows, setSubtreeRows] = useState<TagRow[]>([]);
  const [subtreeLoading, setSubtreeLoading] = useState(false);

  const totalUsage = tags.reduce((sum, tag) => sum + tag.usageCount, 0);

  /** 这个标签下面有没有子标签（直接子标签）。 */
  const hasChildren = (tag: TagRow): boolean => tags.some((item) => item.parentId === tag.id);

  /** 标签 ID → 名称（父标签那一列用）。 */
  const nameOf = (id: string | null): string =>
    tags.find((item) => item.id === id)?.name ?? "—";

  /**
   * 打开某个标签的子树。
   *
   * 删除带子标签的标签会被服务端拒（「下仍有子标签，请先移除子标签」），
   * 但那句话不说是哪些——这里把它们列出来，管理员才知道先删哪个。
   */
  const openSubtree = async (tag: TagRow) => {
    setSubtreeTag(tag);
    setSubtreeRows([]);
    setSubtreeLoading(true);
    try {
      setSubtreeRows(await descendants(tag.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取子标签失败");
    } finally {
      setSubtreeLoading(false);
    }
  };

  // 上级标签只能取同一维度里的标签（维度隔离）。
  const parentOptions = useMemo(
    () => tags.filter((tag) => tag.group === group && tag.id !== editing?.id),
    [tags, group, editing?.id],
  );

  const openCreate = () => {
    setEditing(null);
    setName("");
    setGroup("domain");
    setCode("");
    setParentId("");
    setDialogOpen(true);
  };

  const openEdit = (tag: TagRow) => {
    setEditing(tag);
    setName(tag.name);
    setGroup(tag.group);
    setCode(tag.code);
    setParentId("");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editing) {
        await update({
          id: editing.id,
          name,
          group,
          ...(remote ? { parentId: parentId || null } : {}),
        });
        toast.ok("标签已更新");
      } else {
        await create({
          name,
          group,
          ...(remote ? { code, parentId: parentId || null } : {}),
        });
        toast.ok("标签已创建");
      }
      setDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await remove(pendingDelete.id);
      toast.ok(`已删除标签「${pendingDelete.name}」并解除 ${pendingDelete.usageCount} 处挂载`);
      setPendingDelete(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
      setPendingDelete(null);
    }
  };

  // 明细列只在 mock 模式有：真实后端只给挂载总数。
  const showBreakdown = !remote;
  const columnCount = showBreakdown ? 7 : 4;

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
                      {showBreakdown ? <th scope="col">题目</th> : null}
                      {showBreakdown ? <th scope="col">题库</th> : null}
                      {showBreakdown ? <th scope="col">试卷</th> : null}
                      {showBreakdown ? <th scope="col">练习</th> : null}
                      <th scope="col">挂载</th>
                      <th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.length === 0 ? (
                      <tr>
                        <td colSpan={columnCount}>
                          <div className="empty">
                            <span className="empty-title">该分组暂无标签</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      list.map((tag) => {
                        const usage = tag.breakdown;
                        return (
                          <tr key={tag.id}>
                            <td>
                              <div className="strong" style={{ fontWeight: 500 }}>
                                {tag.name}
                              </div>
                              <div className="text-xs text-3 mono">
                                {tag.code || tag.id}
                              </div>
                            </td>
                            {showBreakdown ? <td className="num">{usage?.questions ?? 0}</td> : null}
                            {showBreakdown ? <td className="num">{usage?.banks ?? 0}</td> : null}
                            {showBreakdown ? <td className="num">{usage?.exams ?? 0}</td> : null}
                            {showBreakdown ? <td className="num">{usage?.practices ?? 0}</td> : null}
                            <td className="num">{tag.usageCount}</td>
                            <td className="col-actions">
                              {hasChildren(tag) ? (
                                <>
                                  <Button size="sm" onClick={() => void openSubtree(tag)}>
                                    子标签
                                  </Button>{" "}
                                </>
                              ) : null}
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
        删除标签后，题库、题目、试卷与练习上对应的挂载会一并解除，对象本身保留。
        仍有子标签或已关联用户的标签会被服务端拒绝删除并说明原因。
        难度标签的名称与等级对应：基础 / 中等 / 较难。
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
            <Button variant="primary" onClick={() => void handleSave()}>
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

        {remote && !editing ? (
          <div style={{ marginTop: "var(--sp-4)" }}>
            <Field
              htmlFor="tg-code"
              label="标签编码"
              hint="编码唯一且创建后不可改（外部引用靠它）。默认按「分组 + 名称」派生，只允许字母（含中文）、数字、下划线、点与中划线。"
            >
              <TextInput
                id="tg-code"
                value={code}
                placeholder={deriveTagCode(group, name || "标签名")}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
          </div>
        ) : null}

        {remote ? (
          <div style={{ marginTop: "var(--sp-4)" }}>
            <Field
              htmlFor="tg-parent"
              label="上级标签"
              hint="同一维度内可设父标签形成树；留空表示顶级标签。"
            >
              <SelectInput
                id="tg-parent"
                value={parentId}
                onChange={(event) => setParentId(event.target.value)}
              >
                <option value="">顶级标签</option>
                {parentOptions.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
        ) : null}

        {editing ? (
          <p className="section-note" style={{ marginTop: "var(--sp-4)" }}>
            当前挂载 {editing.usageCount} 处
            {editing.breakdown
              ? `（题目 ${editing.breakdown.questions} / 题库 ${editing.breakdown.banks} / 试卷 ${editing.breakdown.exams} / 练习 ${editing.breakdown.practices}）`
              : ""}
          </p>
        ) : null}
      </Dialog>

      {/* 子标签：这个标签下面挂着哪些标签（含子孙）。 */}
      <Dialog
        open={subtreeTag !== null}
        onClose={() => setSubtreeTag(null)}
        title={subtreeTag ? `「${subtreeTag.name}」下面挂着的标签` : ""}
        footer={
          <Button variant="secondary" onClick={() => setSubtreeTag(null)}>
            关闭
          </Button>
        }
      >
        {subtreeLoading ? <p className="section-note">读取子标签…</p> : null}
        {subtreeRows.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">标签</th>
                  <th scope="col">编码</th>
                  <th scope="col">父标签</th>
                  <th scope="col">挂载</th>
                </tr>
              </thead>
              <tbody>
                {subtreeRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td className="text-xs mono">{row.code || "—"}</td>
                    <td>{nameOf(row.parentId)}</td>
                    <td className="num">{row.usageCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : subtreeLoading ? null : (
          <p className="section-note">这个标签下面没有子标签。</p>
        )}
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除标签"
        message={
          pendingDelete
            ? `将删除标签「${pendingDelete.name}」，并解除其 ${pendingDelete.usageCount} 处挂载。对象本身保留，操作不可撤销。`
            : ""
        }
        confirmText="确认删除"
        confirmVariant="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
