/* ==========================================================================
   知行测评 · 管理端概览
   --------------------------------------------------------------------------
   对应原型 admin.overview。工作台汇总内容生产、组卷与阅卷三类待办，
   所有数字直接来自当前题库状态，可直接跳转处理。
   ========================================================================== */

import { useNavigate } from "react-router-dom";
import { Badge, Button, Empty, PageHead, Stat, toast } from "@exam/shared";
import { PAPER_MODES } from "@exam/shared/engine";
import { Icon } from "@/app/Icon";
import { modeLabelOf } from "../shared/scope";
import { useAdminOverview } from "./useAdminOverview";

/** 待办卡片。 */
function TodoCard({
  icon,
  label,
  count,
  hint,
  actionLabel,
  onAction,
  tone,
}: {
  icon: string;
  label: string;
  count: number;
  hint: string;
  actionLabel: string;
  onAction: () => void;
  tone: "todo" | "done";
}) {
  return (
    <article className={`todo-card ${tone === "todo" ? "is-todo" : "is-done"}`}>
      <div className="todo-icon" aria-hidden="true">
        <Icon name={icon} />
      </div>
      <div className="todo-main">
        <span className="todo-label">{label}</span>
        <span className="todo-count">{count}</span>
        <span className="todo-hint">{hint}</span>
      </div>
      <Button size="sm" onClick={onAction}>
        {actionLabel}
      </Button>
    </article>
  );
}

/** 概览页。 */
export function OverviewPage() {
  const navigate = useNavigate();
  // 看板的数字由各资源自己数，前端拼起来（数据通路见 useAdminOverview.ts）。
  const { data } = useAdminOverview();
  const {
    questionTotal,
    published,
    drafts,
    disabled,
    bankCount,
    examCount,
    draftExams,
    practiceCount,
    draftPractices,
    pendingReviews,
    sessionCount,
    ongoingSessions,
    userCount,
    blocked,
    templates,
    imports,
  } = data;

  const todoCount =
    drafts +
    draftExams +
    draftPractices +
    pendingReviews +
    blocked.length;

  return (
    <>
      <PageHead
        title="概览"
        sub="工作台汇总内容生产、组卷与阅卷三类待办，所有数字直接来自当前题库状态，可直接跳转处理。"
        actions={
          <>
            <Button onClick={() => navigate("/papers/new?kind=exam")}>
              <Icon name="plus" />
              新建试卷
            </Button>
            <Button variant="primary" onClick={() => navigate("/banks/__all__?tab=produce")}>
              <Icon name="layers" />
              内容生产
            </Button>
          </>
        }
      />

      <div className="stat-row" style={{ marginBottom: "var(--sp-5)" }}>
        <Stat label="题目总数" value={questionTotal} unit="道" hint={`覆盖 ${bankCount} 个题库`} />
        <Stat label="已发布" value={published} unit="道" hint="可被组卷与练习引用" />
        <Stat label="试卷" value={examCount} unit="份" hint={`${draftExams} 份待发布`} />
        <Stat label="练习" value={practiceCount} unit="个" hint={`${draftPractices} 个待上架`} />
        <Stat label="待阅卷" value={pendingReviews} unit="份" hint="主观题评分队列" />
        <Stat
          label="进行中场次"
          value={ongoingSessions}
          unit="场"
          hint={`共 ${sessionCount} 场 · ${userCount} 个账号`}
        />
      </div>

      <div className="grid-main">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">待办工作台</h2>
            <span className="text-sm text-3">{todoCount} 项待处理</span>
          </div>
          <div className="card-body">
            <div className="todo-list">
              <TodoCard
                icon="layers"
                label="候选题待审核"
                count={drafts}
                hint="导入与 AI 生成的题目需审核发布后方可组卷"
                actionLabel="去审核"
                tone={drafts > 0 ? "todo" : "done"}
                onAction={() => navigate("/banks/__all__?tab=candidates")}
              />
              <TodoCard
                icon="clipboard"
                label="试卷待发布"
                count={draftExams}
                hint="已配置但尚未发布到答题端"
                actionLabel="去组卷"
                tone={draftExams > 0 ? "todo" : "done"}
                onAction={() => navigate("/papers?kind=exam")}
              />
              <TodoCard
                icon="book"
                label="练习待上架"
                count={draftPractices}
                hint="开放范围与规则就绪后即可上架"
                actionLabel="去上架"
                tone={draftPractices > 0 ? "todo" : "done"}
                onAction={() => navigate("/papers?kind=practice")}
              />
              <TodoCard
                icon="edit"
                label="待人工阅卷"
                count={pendingReviews}
                hint="主观题提交后进入阅卷队列"
                actionLabel="去阅卷"
                tone={pendingReviews > 0 ? "todo" : "done"}
                onAction={() => navigate("/review")}
              />
              <TodoCard
                icon="alert"
                label="发布校验未通过"
                count={blocked.length}
                hint="题量、分值、名单等检查项存在未通过项"
                actionLabel="去处理"
                tone={blocked.length > 0 ? "todo" : "done"}
                onAction={() =>
                  blocked.length > 0
                    ? navigate(`/papers/${blocked[0]!.id}?kind=${blocked[0]!.kind}&step=publish`)
                    : navigate("/papers")
                }
              />
              <TodoCard
                icon="flag"
                label="已停用题目"
                count={disabled}
                hint="停用后不可被组卷引用，可随时恢复"
                actionLabel="去复核"
                tone={disabled > 0 ? "todo" : "done"}
                onAction={() => navigate("/banks/__all__?tab=questions")}
              />
            </div>
          </div>
        </section>

        <div>
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">内容状态分布</h2>
            </div>
            <div className="card-body">
              <div className="bar-row">
                <span className="od-truncate">已发布</span>
                <span className="bar-track">
                  <span
                    className="bar-fill is-ok"
                    style={{
                      width: `${questionTotal > 0 ? Math.round((published / questionTotal) * 100) : 0}%`,
                    }}
                  />
                </span>
                <span className="right num text-sm">{published} 道</span>
              </div>
              <div className="bar-row">
                <span className="od-truncate">草稿（候选题）</span>
                <span className="bar-track">
                  <span
                    className="bar-fill is-warn"
                    style={{
                      width: `${questionTotal > 0 ? Math.round((drafts / questionTotal) * 100) : 0}%`,
                    }}
                  />
                </span>
                <span className="right num text-sm">{drafts} 道</span>
              </div>
              <div className="bar-row">
                <span className="od-truncate">已停用</span>
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{
                      width: `${questionTotal > 0 ? Math.round((disabled / questionTotal) * 100) : 0}%`,
                    }}
                  />
                </span>
                <span className="right num text-sm">{disabled} 道</span>
              </div>
              <p className="section-note" style={{ marginTop: "var(--sp-3)" }}>
                仅「已发布」题目可进入试卷与练习；草稿需审核发布，停用可恢复。
              </p>
            </div>
          </section>

          <section className="card" style={{ marginTop: "var(--sp-4)" }}>
            <div className="card-head">
              <h2 className="card-title">卷型模板</h2>
              <span className="text-sm text-3">{templates.length} 个</span>
            </div>
            <div className="card-body">
              {templates.length === 0 ? (
                <Empty
                  title="暂无卷型模板"
                  body="在组卷向导中可把配分与卷型保存为模板。"
                />
              ) : (
                <ul className="todo-list" style={{ padding: 0, listStyle: "none" }}>
                  {templates.map((t) => (
                    <li className="todo-card is-done" key={t.id} style={{ padding: "var(--sp-3)" }}>
                      <div className="todo-main">
                        <span className="todo-label">{t.name}</span>
                        <span className="todo-hint">
                          {(t.kind === "practice" ? "练习" : "试卷") +
                            " · " +
                            modeLabelOf(t.mode, PAPER_MODES) +
                            " · " +
                            t.itemCount +
                            " 题 · " +
                            t.durationMin +
                            " 分钟"}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        onClick={() =>
                          toast.ok(
                            `${t.name}：${modeLabelOf(t.mode, PAPER_MODES)} · ${
                              t.itemCount
                            } 题 · ${t.durationMin} 分钟`,
                          )
                        }
                      >
                        查看
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="card" style={{ marginTop: "var(--sp-4)" }}>
            <div className="card-head">
              <h2 className="card-title">最近生产批次</h2>
            </div>
            <div className="card-body is-flush">
              {imports.length === 0 ? (
                <Empty title="暂无批次" body="导入或 AI 生成后会在此留痕。" />
              ) : (
                <ul className="list">
                  {imports.slice(0, 3).map((b) => (
                    <li className="list-row" key={b.id}>
                      <div>
                        <div className="strong" style={{ fontWeight: 500 }}>
                          {b.fileName}
                        </div>
                        <div className="text-xs text-3">
                          {b.id} · {b.createdAt} · {b.rowCount} 行
                        </div>
                      </div>
                      <Badge tone={b.status === "adopted" ? "ok" : "warn"}>
                        {b.status === "adopted" ? "已采纳" : "待采纳"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
