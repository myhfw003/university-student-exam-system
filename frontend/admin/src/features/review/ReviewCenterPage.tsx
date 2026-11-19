/* ==========================================================================
   知行测评 · 管理端阅卷中心
   --------------------------------------------------------------------------
   对应原型 admin.review。主观题由系统按关键词给出初判建议，管理端复核后给出
   最终分数与评语。

   数据通路见 `useReviewTasks.ts`：真实后端模式下，初判建议、要点命中与
   步骤命中都由服务端给，前端不重算。
   ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  Dialog,
  Empty,
  PageHead,
  SearchInput,
  Segmented,
  TagChip,
  TextArea,
  TextInput,
  toast,
} from "@exam/shared";
import { formatScore } from "@exam/shared";
import { isBackendEnabled } from "@exam/shared/api";
import { getTag } from "@exam/shared/mock/catalog";
import { TYPE_LABEL } from "@exam/shared/engine/paper";
import type { QuestionType } from "@exam/shared/domain/types";
import { DifficultyChip, TagChips, TypeBadge } from "../shared/bits";
import { usePeopleCandidates } from "../shared/usePeopleCandidates";
import { useReviewQueue, type ReviewDetailView } from "./useReviewTasks";

/** 阅卷筛选。 */
type ReviewFilter = "pending" | "in_review" | "reviewed" | "all";

/**
 * 实体在「知识点」分组中的标签；无知识点时回退到「领域」。
 * 对应原型 admin.js:97-108 knowledgeTag。
 */
function knowledgeTagOf(entity: { tags: readonly string[] }): { name: string } | null {
  for (const id of entity.tags) {
    const tag = getTag(id);
    if (tag && tag.group === "knowledge_point") return tag;
  }
  for (const id of entity.tags) {
    const tag = getTag(id);
    if (tag && tag.group === "domain") return tag;
  }
  return null;
}

/** 阅卷中心。 */
export function ReviewCenterPage() {
  const remote = isBackendEnabled();

  const [filter, setFilter] = useState<ReviewFilter>("pending");
  /** 只看指派给我的卷子（后端的 `mine`）。 */
  const [mineOnly, setMineOnly] = useState(false);
  const [currentId, setCurrentId] = useState("");
  const [detail, setDetail] = useState<ReviewDetailView | null>(null);
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  /** 批量采纳初判建议的二次确认。 */
  const [batchAdoptOpen, setBatchAdoptOpen] = useState(false);
  /** 指派阅卷人（真实后端模式）。 */
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignPicked, setAssignPicked] = useState("");
  const [assignKeywordRaw, setAssignKeywordRaw] = useState("");
  const [assignSaving, setAssignSaving] = useState(false);

  const queue = useReviewQueue({ status: filter, mine: mineOnly });
  const { items, counts, loadDetail, saveGrade, batchAdopt, claim, assign, refresh } = queue;
  // 候选阅卷人：姓名要显示在「当前指派」上，所以一进页面就取（HTTP 模式）。
  const people = usePeopleCandidates(remote);

  // 队列变化或换卷宗时同步当前卷宗。
  useEffect(() => {
    if (items.length === 0) {
      setDetail(null);
      return;
    }
    const target = items.find((item) => item.id === currentId) ?? items[0];
    if (!target) return;
    if (target.id !== currentId) setCurrentId(target.id);
    if (remote) {
      // HTTP 模式：列表只给摘要，卷宗细节（题干、参考答案、命中）另取。
      void loadDetail(target.id).then((loaded) => {
        if (loaded) setDetail(loaded);
      });
    } else {
      setDetail(target);
    }
  }, [items, currentId, remote, loadDetail]);

  // 载入教师评分与评语：换卷宗时按服务端给的分数与评语重置。
  useEffect(() => {
    if (!detail) return;
    setScore(detail.finalScore ?? detail.suggestedScore ?? 0);
    setComment(detail.comment);
  }, [detail]);

  const maxScore = detail?.maxScore ?? 0;

  const handleSave = async () => {
    if (!detail) return;
    try {
      await saveGrade(detail.id, score, comment);
      toast.ok(`已保存评分：${formatScore(score)} / ${formatScore(maxScore)} 分`);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  /** 批量采纳：空队列直接提示，否则走二次确认。 */
  const handleBatchAdopt = () => {
    if (counts.pending === 0 && items.filter((i) => i.status === "pending").length === 0) {
      toast.ok("没有待阅卷的作答");
      return;
    }
    setBatchAdoptOpen(true);
  };

  const confirmBatchAdopt = async () => {
    setBatchAdoptOpen(false);
    const pendingIds = items.filter((i) => i.status === "pending").map((i) => i.id);
    try {
      const result = await batchAdopt(pendingIds);
      if (result.skipped > 0) {
        toast.error(`已批量采纳 ${result.adopted} 份，跳过 ${result.skipped} 份`);
      } else {
        toast.ok(`已批量采纳 ${result.adopted} 份卷宗的初判建议`);
      }
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "批量采纳失败");
    }
  };

  /** 上一份 / 下一份。 */
  const step = (delta: number) => {
    if (items.length === 0) return;
    const index = items.findIndex((item) => item.id === currentId);
    const next = items[(index + delta + items.length) % items.length];
    if (next) setCurrentId(next.id);
  };

  /** 指派阅卷人。能不能真的阅卷由服务端判定（没有阅卷权限会被拒）。 */
  const handleAssign = async () => {
    if (!detail || !assignPicked) return;
    setAssignSaving(true);
    try {
      await assign(detail.id, assignPicked);
      const name = people.candidates.find((candidate) => candidate.id === assignPicked)?.name;
      toast.ok(`已指派给 ${name ?? "该教师"}`);
      setAssignOpen(false);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "指派失败");
    } finally {
      setAssignSaving(false);
    }
  };

  /**
   * 领取任务（先到先得）。
   *
   * 领取后任务变成「阅卷中」，别的教师就抢不走了；被指派给别人的任务也领不了。
   */
  const handleClaim = async () => {
    if (!detail) return;
    try {
      await claim(detail.id);
      toast.ok("已领取这份卷宗");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "领取失败");
    }
  };

  // 当前卷宗指派给了谁（候选人表里查姓名；查不到就显示账号 ID）。
  const assigneeName = detail?.assigneeId
    ? (people.candidates.find((candidate) => candidate.id === detail.assigneeId)?.name ??
      detail.assigneeId)
    : "";

  // 候选按账号或姓名过滤。
  const assignKeyword = assignKeywordRaw.trim().toLowerCase();
  const visiblePeople = people.candidates.filter(
    (candidate) =>
      !assignKeyword ||
      `${candidate.account} ${candidate.name}`.toLowerCase().includes(assignKeyword),
  );

  const statusBadge = useMemo(() => {
    if (!detail) return null;
    return (
      <Badge tone={detail.status === "reviewed" ? "ok" : "warn"}>
        {detail.status === "reviewed" ? "已阅卷" : detail.status === "in_review" ? "阅卷中" : "待阅卷"}
      </Badge>
    );
  }, [detail]);

  return (
    <>
      <PageHead
        title="阅卷中心"
        sub={`主观题由系统按关键词给出初判建议，管理端复核后给出最终分数与评语。当前待阅 ${counts.pending} 份，阅卷中 ${counts.inReview} 份，已阅 ${counts.reviewed} 份。`}
        actions={
          <Button onClick={handleBatchAdopt}>批量采纳初判建议</Button>
        }
      />

      <div className="split-side">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">卷宗队列</h2>
          </div>
          <div className="card-body" style={{ paddingBottom: "var(--sp-3)" }}>
            <Segmented
              label="阅卷状态筛选"
              value={filter}
              onChange={(next) => setFilter(next)}
              options={[
                { value: "pending", label: `待阅卷 ${counts.pending}` },
                { value: "in_review", label: `阅卷中 ${counts.inReview}` },
                { value: "reviewed", label: `已阅卷 ${counts.reviewed}` },
                { value: "all", label: `全部 ${items.length}` },
              ]}
            />
            {remote ? (
              <label className="checkline" style={{ marginTop: "var(--sp-3)" }}>
                <input
                  type="checkbox"
                  checked={mineOnly}
                  onChange={(event) => setMineOnly(event.target.checked)}
                />
                <span className="checkline-text">只看指派给我的（{counts.mine}）</span>
              </label>
            ) : null}
          </div>
          <div className="card-body is-flush">
            {items.length === 0 ? (
              <Empty title="队列为空" body="答题者在答题端交卷后，主观题作答会自动进入阅卷队列。" />
            ) : (
              items.map((item) => (
                <div
                  className={`list-row${item.id === currentId ? " is-active" : ""}`}
                  key={item.id}
                  data-enter
                  role="button"
                  tabIndex={0}
                  onClick={() => setCurrentId(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setCurrentId(item.id);
                    }
                  }}
                >
                  <div className="list-main">
                    <div className="list-title">
                      {item.studentName || item.studentUsername}
                      <Badge
                        tone={item.status === "reviewed" ? "ok" : "warn"}
                        className="badge"
                      >
                        {item.status === "reviewed" ? "已阅" : "待阅"}
                      </Badge>
                    </div>
                    <div className="list-sub">
                      {item.examName} ·{" "}
                      <TypeBadge type={item.questionType} />
                      {item.stepCode ? ` · 步骤 ${item.stepCode}` : ""}
                      {item.attemptNo > 1 ? ` · 第 ${item.attemptNo} 次作答` : ""}
                    </div>
                  </div>
                  <div className="spacer" />
                  <div className="text-xs text-3 nowrap">{item.submittedAt}</div>
                </div>
              ))
            )}
          </div>
        </section>

        <div>
          {!detail ? (
            <section className="card">
              <Empty
                title="没有需要阅卷的作答"
                body="答题者在答题端交卷后，主观题作答会自动进入阅卷队列。"
              />
            </section>
          ) : (
            <>
              <div className="card" style={{ marginBottom: "var(--sp-4)" }}>
                <div className="card-head">
                  <h2 className="card-title">答题者作答</h2>
                  <span className="text-sm text-3">{detail.submittedAt}</span>
                </div>
                <div className="card-body">
                  <div className="kv" style={{ marginBottom: "var(--sp-3)" }}>
                    <dt>答题者</dt>
                    <dd>
                      {detail.studentName || detail.studentUsername || "—"}
                      {detail.studentUsername ? ` · ${detail.studentUsername}` : ""}
                    </dd>
                    <dt>试卷</dt>
                    <dd>{detail.examName}</dd>
                    <dt>题目</dt>
                    <dd>
                      {detail.questionCode} ·{" "}
                      {detail.questionTypeLabel ||
                        TYPE_LABEL[detail.questionType as QuestionType] ||
                        detail.questionType}{" "}
                      {maxScore} 分
                      {detail.stepCode ? ` · 步骤 ${detail.stepCode}` : ""}
                    </dd>
                    <dt>作答次序</dt>
                    <dd>第 {detail.attemptNo} 次作答</dd>
                    <dt>指派阅卷人</dt>
                    <dd>{assigneeName || "未指派"}</dd>
                    {detail.tags.length > 0 ? (
                      <>
                        <dt>标签</dt>
                        <dd>
                          <div className="row-tight">
                            <DifficultyChip tags={detail.tags} />
                            <TagChips tags={detail.tags} limit={3} />
                          </div>
                        </dd>
                      </>
                    ) : null}
                  </div>
                  <div className="q-stem" style={{ marginBottom: "var(--sp-3)" }}>
                    {detail.stem}
                  </div>
                  {knowledgeTagOf(detail) ? (
                    <div className="row-tight" style={{ marginBottom: "var(--sp-3)" }}>
                      <span className="text-sm text-3">知识点</span>
                      <TagChip group="knowledge_point" className="is-知识点" title="知识点">
                        {knowledgeTagOf(detail)?.name}
                      </TagChip>
                    </div>
                  ) : null}
                  <div className="analysis" style={{ whiteSpace: "pre-wrap" }}>
                    {detail.answerText || "（未作答）"}
                  </div>
                </div>
              </div>

              {detail.reference ? (
                <section className="card" style={{ marginBottom: "var(--sp-4)" }}>
                  <div className="card-head">
                    <h2 className="card-title">参考答案</h2>
                  </div>
                  <div className="card-body">
                    <div className="analysis" style={{ whiteSpace: "pre-wrap" }}>
                      {detail.reference}
                    </div>
                    {detail.analysis ? (
                      <p className="section-note" style={{ marginTop: "var(--sp-3)" }}>
                        {detail.analysis}
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {detail.points.length > 0 ? (
                <section className="card" style={{ marginBottom: "var(--sp-4)" }}>
                  <div className="card-head">
                    <h2 className="card-title">评分要点命中</h2>
                    <span className="text-sm text-3">
                      系统初判 {formatScore(detail.suggestedScore ?? 0)} / {formatScore(maxScore)} 分
                    </span>
                  </div>
                  <div className="card-body">
                    <div className="kp-list">
                      {detail.points.map((point) => (
                        <div className={`kp${point.hit ? " is-hit" : ""}`} key={point.text}>
                          <span className="kp-mark">{point.hit ? "✓" : "○"}</span>
                          <span>{point.text}</span>
                          {point.score !== undefined && point.max !== undefined ? (
                            <span className="text-xs text-3 num">
                              {formatScore(point.score)} / {formatScore(point.max)}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              {detail.steps.length > 0 ? (
                <section className="card" style={{ marginBottom: "var(--sp-4)" }}>
                  <div className="card-head">
                    <h2 className="card-title">步骤评分</h2>
                    <span className="text-sm text-3">
                      系统初判 {formatScore(detail.suggestedScore ?? 0)} / {formatScore(maxScore)} 分
                    </span>
                  </div>
                  <div className="card-body">
                    <div className="kp-list">
                      {detail.steps.map((step) => (
                        <div className={`kp${step.hit ? " is-hit" : ""}`} key={step.code}>
                          <span className="kp-mark">{step.hit ? "✓" : "○"}</span>
                          <span>{step.prompt}</span>
                          <span className="text-xs text-3 num">
                            {formatScore(step.score)} / {formatScore(maxScore)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              <section className="card">
                <div className="card-head">
                  <h2 className="card-title">评分与评语</h2>
                  <div className="row-tight">
                    {statusBadge}
                    {remote && detail.status === "pending" ? (
                      <>
                        <Button size="sm" onClick={() => void handleClaim()}>
                          领取任务
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setAssignPicked(detail.assigneeId ?? "");
                            setAssignKeywordRaw("");
                            setAssignOpen(true);
                          }}
                        >
                          指派阅卷人
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="card-body">
                  <div className="field" style={{ marginBottom: "var(--sp-4)" }}>
                    <span className="field-label">最终得分</span>
                    <div className="row-tight">
                      {Array.from({ length: Math.floor(maxScore) + 1 }, (_, n) => (
                        <button
                          key={n}
                          type="button"
                          className={`chip${score === n ? " is-on" : ""}`}
                          aria-pressed={score === n}
                          onClick={() => setScore(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <span className="field-hint">
                      满分 {formatScore(maxScore)} 分，可在上方选择或直接修改下方输入框。
                    </span>
                  </div>
                  <div className="field" style={{ marginBottom: "var(--sp-4)" }}>
                    <label className="field-label" htmlFor="rv-score">
                      分数
                    </label>
                    <TextInput
                      id="rv-score"
                      type="number"
                      min={0}
                      max={maxScore}
                      step={0.5}
                      value={score}
                      onChange={(event) => setScore(Number(event.target.value) || 0)}
                    />
                  </div>
                  <div className="field" style={{ marginBottom: "var(--sp-4)" }}>
                    <label className="field-label" htmlFor="rv-comment">
                      评语
                    </label>
                    <TextArea
                      id="rv-comment"
                      value={comment}
                      placeholder="写下针对该次作答的评语，答题端成绩报告可见"
                      onChange={(event) => setComment(event.target.value)}
                    />
                  </div>
                  <div className="row">
                    <Button variant="primary" onClick={() => void handleSave()}>
                      保存评分
                    </Button>
                    <Button onClick={() => step(-1)}>上一份</Button>
                    <Button onClick={() => step(1)}>下一份</Button>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={batchAdoptOpen}
        title="批量采纳初判建议"
        message={`将对 ${counts.pending} 份待阅卷宗采用系统按关键词给出的初判分数，并标记为已阅卷。仍可在队列中逐份复核修改。`}
        confirmText="批量采纳"
        onCancel={() => setBatchAdoptOpen(false)}
        onConfirm={() => void confirmBatchAdopt()}
      />

      {/* 指派阅卷人。 */}
      <Dialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="指派阅卷人"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssignOpen(false)}>
              关闭
            </Button>
            <Button
              variant="primary"
              disabled={assignSaving || !assignPicked}
              onClick={() => void handleAssign()}
            >
              {assignSaving ? "指派中…" : "确认指派"}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Callout tone="info" title="指派不改变权限">
            被指派的人必须自己有阅卷权限，否则服务端会拒绝这次指派。
          </Callout>

          <SearchInput
            id="assign-reviewer"
            label="搜索阅卷人"
            placeholder="按账号或姓名过滤"
            value={assignKeywordRaw}
            onChange={setAssignKeywordRaw}
            onSearch={setAssignKeywordRaw}
          />

          {people.error ? (
            <Callout tone="danger" title="候选阅卷人加载失败">
              {people.error}
            </Callout>
          ) : null}

          {people.loading ? (
            <p className="text-3 text-sm">加载候选阅卷人…</p>
          ) : visiblePeople.length === 0 ? (
            <Empty title="没有可选的阅卷人" body="候选是除学生与社会人士以外的账号。" />
          ) : (
            <div className="stack" style={{ maxHeight: "320px", overflowY: "auto" }}>
              {visiblePeople.map((candidate) => (
                <label key={candidate.id} className="checkline">
                  <input
                    type="radio"
                    name="assign-reviewer"
                    checked={assignPicked === candidate.id}
                    onChange={() => setAssignPicked(candidate.id)}
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
