/* ==========================================================================
   知行测评 · 管理端阅卷中心
   --------------------------------------------------------------------------
   对应原型 admin.review。主观题由系统按关键词给出初判建议，管理端复核后给出
   最终分数与评语。
   ========================================================================== */

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  Empty,
  PageHead,
  Segmented,
  TagChip,
  TextArea,
  TextInput,
  toast,
} from "@exam/shared";
import { formatScore } from "@exam/shared";
import {
  className as classNameOf,
  getExam,
  getQuestion,
  getTag,
  updateReview,
  useCatalog,
} from "@exam/shared/mock/catalog";
import {
  gradeShort,
  gradeStep,
  stepScores,
  type KeypointGrade,
} from "@exam/shared/engine/scoring";
import { TYPE_LABEL, itemScoreOf } from "@exam/shared/engine/paper";
import type { QuestionStep, ReviewItem } from "@exam/shared/domain/types";
import { DifficultyChip, TagChips, TypeBadge } from "../shared/bits";

/** 阅卷筛选。 */
type ReviewFilter = "pending" | "reviewed" | "all";

/**
 * 实体在「知识点」分组中的标签；无知识点时回退到「领域」。
 * 对应原型 admin.js:97-108 knowledgeTag。
 */
function knowledgeTagOf(entity: { tags: readonly string[] }): { name: string } | null {
  const tags = entity.tags;
  for (const id of tags) {
    const tag = getTag(id);
    if (tag && tag.group === "knowledge_point") return tag;
  }
  for (const id of tags) {
    const tag = getTag(id);
    if (tag && tag.group === "domain") return tag;
  }
  return null;
}

/** 阅卷中心。 */
export function ReviewCenterPage() {
  const reviews = useCatalog((state) => state.reviews);
  const students = useCatalog((state) => state.students);
  const exams = useCatalog((state) => state.exams);

  const [filter, setFilter] = useState<ReviewFilter>("pending");
  const [currentId, setCurrentId] = useState("");
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [hydratedFor, setHydratedFor] = useState("");
  /** 批量采纳初判建议的二次确认。 */
  const [batchAdoptOpen, setBatchAdoptOpen] = useState(false);

  const pendingCount = reviews.filter((r) => r.status === "pending").length;
  const reviewedCount = reviews.filter((r) => r.status === "reviewed").length;

  const list = useMemo(() => {
    if (filter === "pending") return reviews.filter((r) => r.status === "pending");
    if (filter === "reviewed") return reviews.filter((r) => r.status === "reviewed");
    return reviews;
  }, [reviews, filter]);

  const current = useMemo(() => {
    const found = list.find((r) => r.id === currentId);
    return found ?? list[0] ?? null;
  }, [list, currentId]);

  // 切换卷宗时载入教师评分与评语。
  useMemo(() => {
    if (!current || hydratedFor === current.id) return;
    const auto = autoScoreOf(current);
    setScore(auto?.score ?? 0);
    setComment(current.comment ?? "");
    setHydratedFor(current.id);
  }, [current, hydratedFor]);

  /** 系统初判：按题型走判分引擎，与答题端口径一致。 */
  function autoScoreOf(review: ReviewItem): {
    score: number;
    max: number;
    /** 简答题：各评分要点的命中情况。 */
    points?: KeypointGrade[];
    /** 综合操作题：是否命中该步骤（原型 admin.js:483 的 hit）。 */
    hit?: boolean;
    /** 综合操作题：命中的步骤本体（原型 admin.js:483 的 step，含 prompt）。 */
    step?: QuestionStep;
  } | null {
    const question = getQuestion(review.qid);
    if (!question) return null;
    const exam = getExam(review.examId);
    const paperMax = exam ? itemScoreOf(exam.items, review.qid, question) : question.score;

    if (review.stepId) {
      const step = (question.steps ?? []).find((s) => s.id === review.stepId);
      if (!step) return null;
      const scales = stepScores(question, paperMax);
      const index = (question.steps ?? []).indexOf(step);
      const stepMax = scales[index] ?? step.score;
      const result = gradeStep(step, review.answerText, stepMax);
      return { score: result.score, max: result.max, hit: result.hit, step };
    }

    if (question.type === "short") {
      const result = gradeShort(question, review.answerText, paperMax);
      return { score: result.score, max: result.max, points: result.points };
    }

    return null;
  }

  const auto = current ? autoScoreOf(current) : null;
  const maxScore = auto?.max ?? (current ? getQuestion(current.qid)?.score ?? 0 : 0);
  const question = current ? getQuestion(current.qid) : undefined;
  const exam = current ? getExam(current.examId) : undefined;
  const student = current ? students.find((s) => s.id === current.studentId) : undefined;

  const handleSave = () => {
    if (!current) return;
    const result = updateReview(current.id, {
      teacherScore: score,
      comment,
      status: "reviewed",
    });
    if (!result.ok) {
      toast.error(result.message ?? "保存失败");
      return;
    }
    toast.ok(`已保存评分：${formatScore(score)} / ${formatScore(maxScore)} 分`);
  };

  /** 批量采纳：空队列直接提示，否则走二次确认。 */
  const handleBatchAdopt = () => {
    if (reviews.filter((r) => r.status === "pending").length === 0) {
      toast.ok("没有待阅卷的作答");
      return;
    }
    setBatchAdoptOpen(true);
  };

  const confirmBatchAdopt = () => {
    setBatchAdoptOpen(false);
    const targets = reviews.filter((r) => r.status === "pending");
    let count = 0;
    for (const target of targets) {
      const suggestion = autoScoreOf(target);
      if (!suggestion) continue;
      updateReview(target.id, {
        teacherScore: suggestion.score,
        comment: "系统初判，已批量采纳",
        status: "reviewed",
      });
      count += 1;
    }
    toast.ok(`已批量采纳 ${count} 份卷宗的初判建议`);
  };

  const step = (delta: number) => {
    if (!current || list.length === 0) return;
    const index = list.findIndex((r) => r.id === current.id);
    const next = list[(index + delta + list.length) % list.length];
    if (next) setCurrentId(next.id);
  };

  return (
    <>
      <PageHead
        title="阅卷中心"
        sub={`主观题由系统按关键词给出初判建议，管理端复核后给出最终分数与评语。当前待阅 ${pendingCount} 份，已阅 ${reviewedCount} 份。`}
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
                { value: "pending", label: `待阅卷 ${pendingCount}` },
                { value: "reviewed", label: `已阅卷 ${reviewedCount}` },
                { value: "all", label: `全部 ${reviews.length}` },
              ]}
            />
          </div>
          <div className="card-body is-flush">
            {list.length === 0 ? (
              <Empty title="队列为空" body="答题者在答题端交卷后，主观题作答会自动进入阅卷队列。" />
            ) : (
              list.map((r) => {
                const rStudent = students.find((s) => s.id === r.studentId);
                const rQuestion = getQuestion(r.qid);
                const rExam = exams.find((e) => e.id === r.examId);
                return (
                  <div
                    className={`list-row${r.id === current?.id ? " is-active" : ""}`}
                    key={r.id}
                    data-enter
                    role="button"
                    tabIndex={0}
                    onClick={() => setCurrentId(r.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setCurrentId(r.id);
                      }
                    }}
                  >
                    <div className="list-main">
                      <div className="list-title">
                        {rStudent?.name ?? r.studentId}
                        <Badge
                          tone={r.status === "pending" ? "warn" : "ok"}
                          className="badge"
                        >
                          {r.status === "pending" ? "待阅" : "已阅"}
                        </Badge>
                      </div>
                      <div className="list-sub">
                        {rExam?.name ?? r.examId} ·{" "}
                        {rQuestion ? (
                          <TypeBadge type={rQuestion.type} />
                        ) : (
                          ""
                        )}
                        {r.stepId ? ` · 步骤 ${r.stepId}` : ""}
                        {Number(r.attempt) > 1 ? ` · 第 ${r.attempt} 次作答` : ""}
                      </div>
                    </div>
                    <div className="spacer" />
                    <div className="text-xs text-3 nowrap">{r.submittedAt}</div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <div>
          {!current ? (
            <section className="card">
              <Empty
                title="没有需要阅卷的作答"
                body="答题者在答题端交卷后，主观题作答会自动进入阅卷队列。"
              />
            </section>
          ) : !question ? (
            <section className="card">
              <Empty title="题目已不存在" />
            </section>
          ) : (
            <>
              <div className="card" style={{ marginBottom: "var(--sp-4)" }}>
                <div className="card-head">
                  <h2 className="card-title">答题者作答</h2>
                  <span className="text-sm text-3">{current.submittedAt}</span>
                </div>
                <div className="card-body">
                  <div className="kv" style={{ marginBottom: "var(--sp-3)" }}>
                    <dt>答题者</dt>
                    <dd>
                      {student
                        ? `${student.name} · ${classNameOf(student.classId)} · ${student.id}`
                        : current.studentId}
                    </dd>
                    <dt>试卷</dt>
                    <dd>{exam?.name ?? current.examId}</dd>
                    <dt>题目</dt>
                    <dd>
                      {question.id} · {TYPE_LABEL[question.type]} ·{" "}
                      {maxScore} 分
                      {current.stepId ? ` · 步骤 ${current.stepId}` : ""}
                    </dd>
                    <dt>作答次序</dt>
                    <dd>第 {Number(current.attempt) || 1} 次作答</dd>
                    <dt>标签</dt>
                    <dd>
                      <div className="row-tight">
                        <DifficultyChip tags={question.tags} />
                        <TagChips tags={question.tags} limit={3} />
                      </div>
                    </dd>
                  </div>
                  <div className="q-stem" style={{ marginBottom: "var(--sp-3)" }}>
                    {question.stem}
                  </div>
                  {knowledgeTagOf(question) ? (
                    <div className="row-tight" style={{ marginBottom: "var(--sp-3)" }}>
                      <span className="text-sm text-3">知识点</span>
                      <TagChip group="knowledge_point" className="is-知识点" title="知识点">
                        {knowledgeTagOf(question)?.name}
                      </TagChip>
                    </div>
                  ) : null}
                  <div className="analysis" style={{ whiteSpace: "pre-wrap" }}>
                    {current.answerText || "（未作答）"}
                  </div>
                </div>
              </div>

              {question.reference ? (
                <section className="card" style={{ marginBottom: "var(--sp-4)" }}>
                  <div className="card-head">
                    <h2 className="card-title">参考答案</h2>
                  </div>
                  <div className="card-body">
                    <div className="analysis" style={{ whiteSpace: "pre-wrap" }}>
                      {question.reference}
                    </div>
                    {question.analysis ? (
                      <p className="section-note" style={{ marginTop: "var(--sp-3)" }}>
                        {question.analysis}
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {auto?.points ? (
                <section className="card" style={{ marginBottom: "var(--sp-4)" }}>
                  <div className="card-head">
                    <h2 className="card-title">评分要点命中</h2>
                    <span className="text-sm text-3">
                      系统初判 {formatScore(auto.score)} / {formatScore(auto.max)} 分
                    </span>
                  </div>
                  <div className="card-body">
                    <div className="kp-list">
                      {auto.points.map((p) => (
                        <div className={`kp${p.hit ? " is-hit" : ""}`} key={p.text}>
                          <span className="kp-mark">{p.hit ? "✓" : "○"}</span>
                          <span>{p.text}</span>
                          <span className="text-xs text-3 num">
                            {formatScore(p.score)} / {formatScore(p.max)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              {auto?.step ? (
                <section className="card" style={{ marginBottom: "var(--sp-4)" }}>
                  <div className="card-head">
                    <h2 className="card-title">步骤评分</h2>
                    <span className="text-sm text-3">
                      系统初判 {formatScore(auto.score)} / {formatScore(auto.max)} 分
                    </span>
                  </div>
                  <div className="card-body">
                    <div className="kp-list">
                      <div className={`kp${auto.hit ? " is-hit" : ""}`}>
                        <span className="kp-mark">{auto.hit ? "✓" : "○"}</span>
                        <span>{auto.step.prompt}</span>
                        <span className="text-xs text-3 num">
                          {formatScore(auto.score)} / {formatScore(auto.max)}
                        </span>
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              <section className="card">
                <div className="card-head">
                  <h2 className="card-title">评分与评语</h2>
                  <Badge tone={current.status === "reviewed" ? "ok" : "warn"}>
                    {current.status === "reviewed" ? "已阅卷" : "待阅卷"}
                  </Badge>
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
                    <Button variant="primary" onClick={handleSave}>
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
        message={`将对 ${pendingCount} 份待阅卷宗采用系统按关键词给出的初判分数，并标记为已阅卷。仍可在队列中逐份复核修改。`}
        confirmText="批量采纳"
        onCancel={() => setBatchAdoptOpen(false)}
        onConfirm={confirmBatchAdopt}
      />
    </>
  );
}
