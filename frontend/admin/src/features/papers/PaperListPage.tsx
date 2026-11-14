/* ==========================================================================
   知行测评 · 管理端组卷列表
   --------------------------------------------------------------------------
   对应原型 admin.papers。试卷与练习都是「卷对象」：先定基本信息，再选题配分、
   设卷型，最后配置名单与发布。每一步都有发布前校验。
   ========================================================================== */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, ConfirmDialog, PageHead, Segmented, toast } from "@exam/shared";
import {
  className as classNameOf,
  itemsOf,
  preflight,
  removePaper,
  useCatalog,
} from "@exam/shared/mock/catalog";
import { Icon } from "@/app/Icon";
import { PaperBadge, TagChips } from "../shared/bits";
import { EntityTagsDialog } from "../shared/EntityTagsDialog";
import { scopeLabel, sumScore } from "../shared/scope";

/** 组卷列表页。 */
export function PaperListPage() {
  const navigate = useNavigate();
  const exams = useCatalog((state) => state.exams);
  const practices = useCatalog((state) => state.practices);
  const [kind, setKind] = useState<"exam" | "practice">("exam");
  const [pendingDelete, setPendingDelete] = useState<{ kind: "exam" | "practice"; id: string; name: string } | null>(
    null,
  );
  // 「标签」弹窗（原型 admin.entity.tags）。
  const [tagTarget, setTagTarget] = useState<{
    kind: "exam" | "practice";
    id: string;
    name: string;
    tags: string[];
  } | null>(null);

  const list = kind === "exam" ? exams : practices;

  const openTagDialog = (
    tagKind: "exam" | "practice",
    id: string,
    name: string,
    tags: string[],
  ) => {
    setTagTarget({ kind: tagKind, id, name, tags });
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    const result = removePaper(pendingDelete.kind, pendingDelete.id);
    if (!result.ok) {
      toast.error(result.message ?? "删除失败");
      setPendingDelete(null);
      return;
    }
    toast.ok(
      `已删除${pendingDelete.kind === "exam" ? "试卷" : "练习"}「${pendingDelete.name}」`,
    );
    setPendingDelete(null);
  };

  return (
    <>
      <PageHead
        title="组卷"
        sub="试卷与练习都是「卷对象」：先定基本信息，再选题配分、设卷型，最后配置名单与发布。每一步都有发布前校验，未通过的项会阻止发布。"
        actions={
          <>
            <Button onClick={() => navigate("/papers/new?kind=practice")}>
              <Icon name="plus" />
              新建练习
            </Button>
            <Button variant="primary" onClick={() => navigate("/papers/new?kind=exam")}>
              <Icon name="plus" />
              新建试卷
            </Button>
          </>
        }
      />

      <Segmented
        label="卷对象类型"
        value={kind}
        onChange={(next) => setKind(next)}
        options={[
          { value: "exam", label: `考试卷 ${exams.length}` },
          { value: "practice", label: `练习 ${practices.length}` },
        ]}
        className="seg"
      />

      <section className="card" style={{ marginTop: "var(--sp-4)" }}>
        <div className="card-head">
          <h2 className="card-title">{kind === "exam" ? "考试卷" : "练习"}</h2>
          <span className="text-sm text-3">{list.length} 个</span>
        </div>
        <div className="card-body is-flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">名称</th>
                  <th scope="col">状态</th>
                  <th scope="col">题量</th>
                  <th scope="col">总分</th>
                  <th scope="col">时长(分)</th>
                  {kind === "exam" ? (
                    <>
                      <th scope="col">卷型</th>
                      <th scope="col">名单</th>
                    </>
                  ) : (
                    <>
                      <th scope="col">开放范围</th>
                      <th scope="col">可重复次数</th>
                    </>
                  )}
                  <th scope="col">发布校验</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className="empty">
                        <span className="empty-title">暂无对象</span>
                        <span className="empty-body">点击右上角新建。</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  list.map((item) => {
                    const items = itemsOf(item);
                    const check = preflight(kind, item.id);
                    return (
                      <tr key={item.id}>
                        <td>
                          <div className="strong" style={{ fontWeight: 500 }}>
                            {item.name}
                          </div>
                          <div className="text-xs text-3">
                            {kind === "exam"
                              ? ((item as { batch?: string }).batch || "—")
                              : ((item as { note?: string }).note || "—")}
                          </div>
                        </td>
                        <td>
                          <PaperBadge kind={kind} item={item} />
                        </td>
                        <td className="num">{items.length}</td>
                        <td className="num">{sumScore(items)}</td>
                        <td className="num">{item.durationMin || 0}</td>
                        {kind === "exam" ? (
                          <>
                            <td>
                              {(
                                item as unknown as { plum?: { mode: string } }
                              ).plum?.mode === "small"
                                ? "小梅花"
                                : (item as unknown as { plum?: { mode: string } }).plum?.mode ===
                                    "large"
                                  ? "大梅花"
                                  : "标准卷"}
                            </td>
                            <td>
                              {scopeLabel(item.scope, classNameOf)}
                              <div style={{ marginTop: "var(--sp-1)" }}>
                                <TagChips tags={item.tags} limit={3} />
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>
                              {scopeLabel(item.scope, classNameOf)}
                              <div style={{ marginTop: "var(--sp-1)" }}>
                                <TagChips tags={item.tags} limit={3} />
                              </div>
                            </td>
                            <td className="num">
                              {(item as unknown as { repeats?: number }).repeats || 0}
                            </td>
                          </>
                        )}
                        <td>
                          {check.ok ? (
                            <Badge tone="ok">校验通过</Badge>
                          ) : (
                            <button
                              type="button"
                              className="badge badge-warn"
                              title={`${check.failed} 项未通过，点击进入发布校验`}
                              onClick={() =>
                                navigate(`/papers/${item.id}?kind=${kind}&step=publish`)
                              }
                            >
                              {check.failed} 项未通过
                            </button>
                          )}
                        </td>
                        <td className="col-actions">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => navigate(`/papers/${item.id}?kind=${kind}`)}
                          >
                            {kind === "exam" ? "组卷向导" : "练习设置"}
                          </Button>{" "}
                          <Button
                            size="sm"
                            onClick={() =>
                              openTagDialog(kind, item.id, item.name, item.tags)
                            }
                          >
                            标签
                          </Button>{" "}
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() =>
                              setPendingDelete({ kind, id: item.id, name: item.name })
                            }
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

      <EntityTagsDialog
        target={tagTarget}
        onClose={() => setTagTarget(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.kind === "exam" ? "删除试卷" : "删除练习"}
        message={
          pendingDelete
            ? `将删除${pendingDelete.kind === "exam" ? "试卷" : "练习"}「${pendingDelete.name}」及其题目引用，${
                pendingDelete.kind === "exam"
                  ? "关联的阅卷记录也会一并清除。"
                  : "管理端与答题端的入口都会移除。"
              }操作不可撤销。`
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
