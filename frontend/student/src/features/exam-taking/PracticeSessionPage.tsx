/* ==========================================================================
   知行测评 · 练习作答页
   --------------------------------------------------------------------------
   对应原型 student.practice.session。相对原型新增（设计文档要求）：
   - 作答经四层保障持久化与上行，不再直接写 localStorage
   - 练习不计时、不限制切屏（不启用 FocusGuard）
   - 重复次数校验、错题回流
   ========================================================================== */

import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AnswerSheet,
  Button,
  Empty,
  KeypointList,
  Stat,
  formatClock,
  formatDateTime,
  formatScore,
  toast,
} from "@exam/shared";
import type { GradedDetail } from "@exam/shared/engine/scoring";
import type { AttemptFeedbackQuestion } from "@exam/shared/domain/attempt";
import {
  gradeComprehensive,
  gradeObjective,
  gradeShort,
} from "@exam/shared/engine/scoring";
import type { Question } from "@exam/shared/domain/types";
import type { ExamResponses } from "@/stores/examSessionStore";
import { Icon } from "@/app/Icon";
import { GradedDetailRow } from "@/features/shared/GradedDetailRow";
import { ExamBar } from "./ExamBar";
import { OfflineBadge } from "./OfflineBadge";
import { QuestionPane } from "./QuestionPane";
import { usePracticeSession } from "./usePracticeSession";

/** 练习作答页。 */
export function PracticeSessionPage() {
  const { assignmentId = "" } = useParams();
  const navigate = useNavigate();
  const controller = usePracticeSession(assignmentId);

  const { practice, paper, current, responses, flags, answeredCount, result, submitted } = controller;

  if (!practice || !paper) {
    return (
      <div className="card">
        <Empty
          title="练习不存在"
          body="该练习可能已被移除，请返回练习中心重新选择。"
          action={<Button onClick={() => navigate("/practice")}>返回练习中心</Button>}
        />
      </div>
    );
  }

  /* ---------------------------------------------------------- 结果视图 */

  if (submitted && result) {
    const total = paper.items.length;
    const correct = result.details.filter((d) => d.status === "correct").length;
    // 原型 student.js:886：待订正 = status !== "correct"，含空白与待阅。
    const wrong = result.details.filter((d) => d.status !== "correct").length;
    const knowledgePoints = new Set(
      result.details.flatMap((d) => d.question.tags).filter((t) => t.startsWith("t-pt-")),
    ).size;
    const rate = result.totalMax > 0 ? Math.round((result.total / result.totalMax) * 100) : 0;

    return (
      <>
        <div className="page-head">
          <div>
            <h1 className="page-title">{practice.name}</h1>
            <p className="page-sub">
              提交于 {formatDateTime(controller.submittedAt)} · 用时{" "}
              {formatClock(controller.elapsedSec)}
            </p>
          </div>
          <div className="page-actions">
            <Button onClick={() => navigate("/practice")}>返回练习中心</Button>
            <Button
              variant="primary"
              onClick={() => {
                const outcome = controller.redo();
                // 原型 student.js:1782：次数用完走 toast 报错，不是常驻提示条。
                if (!outcome.ok && outcome.message) toast.error(outcome.message);
                // 原型 student.js:1795：重置成功后提示「已重置练习，可以重新作答」。
                if (outcome.ok) toast.ok("已重置练习，可以重新作答");
              }}
            >
              重新练习
            </Button>
          </div>
        </div>

        <div className="stat-row">
          <Stat label="本次得分" value={result.total} unit="分" hint={`总分 ${result.totalMax} 分`} />
          <Stat label="得分率" value={rate} unit="%" hint={`${correct} 题完全正确`} />
          <Stat label="待订正" value={wrong} unit="题" hint="含部分正确与错误" />
          <Stat label="覆盖知识点" value={knowledgePoints} unit="个" hint="按试卷题目统计" />
        </div>

        <section className="card" style={{ marginTop: "var(--sp-5)" }}>
          <div className="card-head">
            <h2 className="card-title">逐题解析</h2>
            <span className="text-sm text-3">共 {total} 题</span>
          </div>
          <div className="card-body is-flush">
            {result.details.map((detail) => (
              <DetailRow key={detail.qid} detail={detail} />
            ))}
          </div>
        </section>
      </>
    );
  }

  /* ---------------------------------------------------------- 作答视图 */

  const total = paper.items.length;
  const isMulti = current?.question.type === "multi";

  const cells = paper.items.map((item) => ({
    slot: item.slot,
    qid: item.qid,
    answered: isAnswered(item.qid, responses),
    marked: Boolean(flags[item.qid]),
  }));

  return (
    <>
      <ExamBar
        title={practice.name}
        note={
          <>
            第 {(controller.current?.slot ?? 1)} / {total} 题 · 已作答{" "}
            <span className="answer-count" data-fmt="practice">
              {answeredCount}
            </span>{" "}
            题 · 练习不计时、不影响考试成绩
          </>
        }
        flagLabel="标记"
        onToggleFlag={() => current && controller.toggleFlag(current.qid)}
        submitLabel="提交练习"
        onSubmit={() => {
          const outcome = controller.submit();
          // 原型 student.js:1629：次数用完走 toast 报错，不是常驻提示条。
          if (!outcome.ok && outcome.message) toast.error(outcome.message);
          // 原型 student.js:1648：提交成功后提示「练习已提交」。
          if (outcome.ok) toast.ok("练习已提交");
        }}
      >
        <OfflineBadge
          offline={controller.offline}
          pending={controller.pending}
          syncing={controller.syncing}
        />
      </ExamBar>

      <div className="split">
        <section className="card">
          <div className="card-body">
            {current ? (
              <>
                <QuestionPane
                  item={current}
                  question={current.question}
                  response={responses[current.qid]}
                  onChoiceChange={(keys) => controller.choose(current.qid, keys)}
                  onTextChange={(text) => controller.writeText(current.qid, text)}
                  onStepChange={(stepId, text) => controller.writeStep(current.qid, stepId, text)}
                />

                {practice.feedback === "immediate" ? (
                  controller.feedback ? (
                    <ServerImmediateFeedback
                      item={controller.feedback.questions.find(
                        (q) => q.questionId === current.qid,
                      )}
                      fromOriginal={current.fromOriginal}
                      response={responses[current.qid]}
                    />
                  ) : (
                    <ImmediateFeedback
                      question={current.question}
                      response={responses[current.qid]}
                    />
                  )
                ) : null}

                <hr className="divider" />

                <div className="row">
                  <button
                    type="button"
                    className="btn"
                    disabled={paper.items.indexOf(current) === 0}
                    onClick={() => controller.goto(paper.items.indexOf(current) - 1)}
                  >
                    <Icon name="chevronLeft" />
                    上一题
                  </button>
                  <div className="spacer" />
                  <span className="text-sm text-3">
                    {isMulti ? "按 Ctrl/⌘ 可多选" : "按 选择一项"}
                  </span>
                  <button
                    type="button"
                    className="btn"
                    disabled={paper.items.indexOf(current) === total - 1}
                    onClick={() => controller.goto(paper.items.indexOf(current) + 1)}
                  >
                    下一题
                    <Icon name="chevronRight" />
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </section>

        <aside className="card">
          <div className="card-head">
            <h2 className="card-title">题号</h2>
          </div>
          <div className="card-body">
            <AnswerSheet
              cells={cells}
              currentSlot={current?.slot ?? 0}
              onSelect={(cell) => controller.goto(cell.slot - 1)}
            />
          </div>
        </aside>
      </div>
    </>
  );
}

/**
 * 逐题解析行。
 *
 * 结构与原型 student.js:863 一致：状态徽标 → 题干 → 题型 → 标签片 →
 * 作答摘要 → 评分要点 / 步骤 → 查看解析。主观题的状态按得分折算
 * （原型 practiceStatus，student.js:1764）。
 */
function DetailRow({ detail }: { detail: GradedDetail }) {
  return <GradedDetailRow detail={detail} variant="practice" />;
}

/** 即时反馈块（仅 feedback === "immediate" 的练习）。 */
/** 单题判分结果（统一成一种形状，便于渲染）。 */
interface OneGrade {
  status: string;
  score: number;
  max: number;
  picked: string[];
  correct: string[];
  points?: Array<{ text: string; hit: boolean; score: number; max: number }>;
  steps?: Array<{ text: string; hit: boolean; score: number; max: number }>;
}

/**
 * 即时反馈：作答后立即给出正误判定与解析（原型 immediateFeedbackHtml）。
 *
 * 只在练习配置 `feedback = "immediate"` 时出现；错题重做也是即时反馈模式。
 */
function ImmediateFeedback({
  question,
  response,
}: {
  question: Question;
  response: ExamResponses[string] | undefined;
}) {
  const graded = useMemo<OneGrade | null>(() => {
    if (!response) return null;
    if (question.type === "single" || question.type === "multi" || question.type === "judge") {
      const res = gradeObjective(question, response.choice ?? [], question.score);
      return {
        status: res.status,
        score: res.score,
        max: res.max,
        picked: res.picked,
        correct: res.correct,
      };
    }
    if (question.type === "short") {
      const res = gradeShort(question, response.text ?? "", question.score);
      return {
        status: res.status,
        score: res.score,
        max: res.max,
        picked: [],
        correct: [],
        points: res.points.map((p) => ({ text: p.text, hit: p.hit, score: p.score, max: p.max })),
      };
    }
    if (question.type === "comprehensive") {
      const res = gradeComprehensive(question, response.steps ?? {}, question.score);
      return {
        status: res.status,
        score: res.score,
        max: res.max,
        picked: [],
        correct: [],
        steps: res.steps.map((s) => ({
          text: s.prompt,
          hit: s.hit,
          score: s.score,
          max: s.max,
        })),
      };
    }
    return null;
  }, [question, response]);

  if (!graded) return null;

  const tone =
    graded.status === "correct"
      ? "ok"
      : graded.status === "wrong"
        ? "danger"
        : graded.status === "pending" || graded.status === "auto"
          ? "info"
          : "warn";
  const label =
    graded.status === "correct"
      ? "回答正确"
      : graded.status === "partial"
        ? "部分正确"
        : graded.status === "wrong"
          ? "回答错误"
          : graded.status === "blank"
            ? "尚未作答"
            : "已记录，等待阅卷";

  const isJudge = question.type === "judge";
  const pickedText = isJudge
    ? graded.picked.length
      ? graded.picked[0] === "A"
        ? "正确"
        : "错误"
      : "未选择"
    : graded.picked.length
      ? graded.picked.join("、")
      : "未选择";

  return (
    <div className={`callout is-${tone}`} role="status">
      <span className="callout-title">{label}</span>
      {question.type === "single" || question.type === "multi" || question.type === "judge" ? (
        <dl className="kv" style={{ marginTop: "var(--sp-2)" }}>
          <dt>你的答案</dt>
          <dd>{pickedText}</dd>
          <dt>正确答案</dt>
          <dd>{graded.correct.length ? graded.correct.join("、") : "—"}</dd>
          <dt>得分</dt>
          <dd>
            {formatScore(graded.score)} / {formatScore(graded.max)}
          </dd>
        </dl>
      ) : (
        <dl className="kv" style={{ marginTop: "var(--sp-2)" }}>
          <dt>作答要点</dt>
          <dd>
            {graded.points ? (
              <KeypointList items={graded.points} />
            ) : graded.steps ? (
              <KeypointList items={graded.steps} />
            ) : (
              "已提交"
            )}
          </dd>
          <dt>参考答案</dt>
          <dd>{question.reference || "由阅卷人评定"}</dd>
        </dl>
      )}
      {question.analysis ? (
        <div className="analysis" style={{ marginTop: "var(--sp-2)" }}>
          {question.analysis}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 服务端给的即时反馈（HTTP 模式）。
 *
 * 正确与否、得分与解析都来自服务端（`POST /attempts/{id}/feedback`）：
 * 前端没有正确答案的副本，也就不自己判。
 */
function ServerImmediateFeedback({
  item,
  fromOriginal,
  response,
}: {
  item: AttemptFeedbackQuestion | undefined;
  fromOriginal: Record<string, string>;
  response: ExamResponses[string] | undefined;
}) {
  if (!item) return null;

  const isSubjective = item.type === "short" || item.type === "comprehensive";
  const picked = response?.choice ?? [];
  // 正确答案给的是原题键，换回卷面上的显示字母。
  const correct = item.correctKeys.map((key) => fromOriginal[key] ?? key);

  const tone =
    item.correct === true ? "ok" : item.correct === false ? "danger" : "info";
  const label =
    item.correct === true
      ? "回答正确"
      : item.correct === false
        ? "回答错误"
        : "已记录，等待阅卷";

  return (
    <div className={`callout is-${tone}`} role="status">
      <span className="callout-title">{label}</span>
      {isSubjective ? (
        <dl className="kv" style={{ marginTop: "var(--sp-2)" }}>
          <dt>得分</dt>
          <dd>
            {formatScore(item.score)} / {formatScore(item.maxScore)}
          </dd>
          <dt>参考答案</dt>
          <dd>{item.referenceAnswer || "由阅卷人评定"}</dd>
        </dl>
      ) : (
        <dl className="kv" style={{ marginTop: "var(--sp-2)" }}>
          <dt>你的答案</dt>
          <dd>{picked.length ? picked.join("、") : "未选择"}</dd>
          <dt>正确答案</dt>
          <dd>{correct.length ? correct.join("、") : "—"}</dd>
          <dt>得分</dt>
          <dd>
            {formatScore(item.score)} / {formatScore(item.maxScore)}
          </dd>
        </dl>
      )}
      {item.analysis ? (
        <div className="analysis" style={{ marginTop: "var(--sp-2)" }}>
          {item.analysis}
        </div>
      ) : null}
    </div>
  );
}

/** 本地判定的「已作答」。 */
function isAnswered(
  qid: string,
  responses: Record<string, { choice?: string[]; text?: string; steps?: Record<string, string> }>,
): boolean {
  const response = responses[qid];
  if (!response) return false;
  if (response.choice && response.choice.length > 0) return true;
  if ((response.text ?? "").trim().length > 0) return true;
  return Object.values(response.steps ?? {}).some((text) => text.trim().length > 0);
}
