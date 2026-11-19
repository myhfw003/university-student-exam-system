/* ==========================================================================
   知行测评 · 管理端组卷列表
   --------------------------------------------------------------------------
   对应原型 admin.papers。试卷与练习都是「卷对象」：先定基本信息，再选题配分、
   设卷型，最后配置名单与发布。每一步都有发布前校验。

   数据通路见 `useAdminPapers.ts`：真实后端模式下
   - **卷型**不在列表摘要里（要看卷型得进向导）；
   - **名单不在试卷上**——名单与开放时间属于**场次**（`/exam-sessions`）；
   - **发布校验**要逐卷调校验接口才拿得到，列表里给一个入口进向导查看。
   ========================================================================== */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, ConfirmDialog, PageHead, Segmented, toast } from "@exam/shared";
import { isBackendEnabled, loadPaper, updatePaper } from "@exam/shared/api";
import { Icon } from "@/app/Icon";
import { EntityTagsDialog } from "../shared/EntityTagsDialog";
import { useAdminPapers } from "./useAdminPapers";

/** 组卷列表页。 */
export function PaperListPage() {
  const navigate = useNavigate();
  const remote = isBackendEnabled();
  const [kind, setKind] = useState<"exam" | "practice">("exam");

  // 两个分段各自取一次：分段上要显示各自的卷数量。
  const examPapers = useAdminPapers("exam");
  const practicePapers = useAdminPapers("practice");
  const current = kind === "exam" ? examPapers : practicePapers;
  const papers = current.papers;
  const remove = current.remove;

  const [pendingDelete, setPendingDelete] = useState<{
    kind: "exam" | "practice";
    id: string;
    name: string;
  } | null>(null);
  // 「标签」弹窗（原型 admin.entity.tags）。
  const [tagTarget, setTagTarget] = useState<{
    kind: "exam" | "practice";
    id: string;
    name: string;
    tags: string[];
  } | null>(null);

  const list = papers;

  /** 打开标签弹窗：HTTP 模式要先取回卷详情（列表摘要里没有标签）。 */
  const openTagDialog = async (
    tagKind: "exam" | "practice",
    id: string,
    name: string,
    tags: string[],
  ) => {
    if (!remote) {
      setTagTarget({ kind: tagKind, id, name, tags });
      return;
    }
    try {
      const detail = await loadPaper(id);
      setTagTarget({ kind: tagKind, id, name, tags: detail.tagIds });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "标签加载失败");
    }
  };

  /** 保存标签：HTTP 模式要带上卷的其余字段（服务端是整份覆盖）。 */
  const saveTags = async (id: string, tags: string[]) => {
    if (!remote) return;
    const detail = await loadPaper(id);
    await updatePaper(id, {
      name: detail.paper.name,
      batch: detail.paper.batch,
      description: detail.paper.description,
      targetTotalScore: detail.paper.targetTotalScore,
      durationMinutes: detail.paper.durationMinutes,
      passScore: detail.paper.passScore,
      note: detail.note,
      tagIds: tags,
      orderRule: detail.orderRule,
      variantRule: detail.variantRule,
      answerPolicy: detail.answerPolicy,
      allowRetake: detail.allowRetake,
      retakeKeepsBest: detail.retakeKeepsBest,
      examRules: detail.examRules,
      practiceRules: detail.practiceRules,
    });
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await remove(pendingDelete.id);
      toast.ok(
        `已删除${pendingDelete.kind === "exam" ? "试卷" : "练习"}「${pendingDelete.name}」`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      setPendingDelete(null);
    }
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
          { value: "exam", label: `考试卷 ${examPapers.papers.length}` },
          { value: "practice", label: `练习 ${practicePapers.papers.length}` },
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
                  list.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="strong" style={{ fontWeight: 500 }}>
                          {item.name}
                        </div>
                        <div className="text-xs text-3">{item.sub || "—"}</div>
                      </td>
                      <td>
                        <Badge tone={item.published ? "ok" : "neutral"}>
                          {item.statusLabel || (item.published ? "已发布" : "草稿")}
                        </Badge>
                      </td>
                      <td className="num">{item.itemCount}</td>
                      <td className="num">{item.totalScore}</td>
                      <td className="num">{item.durationMin}</td>
                      {kind === "exam" ? (
                        <>
                          <td className="text-xs text-3">
                            {remote ? "进向导查看" : item.mode === "small" ? "小梅花" : item.mode === "large" ? "大梅花" : "标准卷"}
                          </td>
                          <td className="text-xs text-3">
                            {remote ? "名单在场次中配置" : "—"}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="text-xs text-3">
                            {remote ? "开放范围在练习分配中配置" : "—"}
                          </td>
                          <td className="num">—</td>
                        </>
                      )}
                      <td>
                        {remote ? (
                          <button
                            type="button"
                            className="badge badge-neutral"
                            onClick={() =>
                              navigate(`/papers/${item.id}?kind=${kind}&step=publish`)
                            }
                          >
                            查看校验
                          </button>
                        ) : (
                          <Badge tone="ok">校验通过</Badge>
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
                            void openTagDialog(kind, item.id, item.name, [])
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <EntityTagsDialog
        target={tagTarget}
        onClose={() => setTagTarget(null)}
        {...(remote
          ? { onSave: (tags: string[]) => saveTags(tagTarget?.id ?? "", tags) }
          : {})}
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
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
