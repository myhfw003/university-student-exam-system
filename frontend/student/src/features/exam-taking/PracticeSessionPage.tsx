/* ==========================================================================
   知行测评 · 练习作答页
   --------------------------------------------------------------------------
   对应原型 student.practice.session。相对原型新增（设计文档要求）：
   - 作答经四层保障持久化与上行，不再直接写 localStorage
   - 练习不计时、不限制切屏（不启用 FocusGuard）
   - 重复次数校验、错题回流
   ========================================================================== */

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Analysis,
  AnswerSheet,
  Badge,
  Button,
  Callout,
  Empty,
  KeypointList,
  Stat,
  formatClock,
  formatDateTime,
} from "@exam/shared";
import type { GradedDetail } from "@exam/shared/engine/scoring";
import { ExamBar } from "./ExamBar";
import { OfflineBadge } from "./OfflineBadge";
import { QuestionPane } from "./QuestionPane";
import { usePracticeSession } from "./usePracticeSession";

/** 练习作答页。 */
export function PracticeSessionPage() {
  const { assignmentId = "" } = useParams();
  const navigate = useNavigate();
  const controller = usePracticeSession(assignmentId);
  const [message, setMessage] = useState<string | null>(null);

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
    const wrong = result.details.filter((d) => d.status === "wrong" || d.status === "partial").length;
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
              提交于 {formatDateTime(new Date())} · 用时 {formatClock(controller.elapsedSec)}
            </p>
          </div>
          <div className="page-actions">
            <Button onClick={() => navigate("/practice")}>返回练习中心</Button>
            <Button
              variant="primary"
              onClick={() => {
                const outcome = controller.redo();
                setMessage(outcome.ok ? null : outcome.message ?? null);
              }}
            >
              重新练习
            </Button>
          </div>
        </div>

        {message ? (
          <div style={{ marginBottom: "var(--sp-4)" }}>
            <Callout tone="danger" title="无法重新练习">
              {message}
            </Callout>
          </div>
        ) : null}

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
        flagLabel="🚩标记"
        onToggleFlag={() => current && controller.toggleFlag(current.qid)}
        submitLabel="提交练习"
        onSubmit={() => {
          const outcome = controller.submit();
          setMessage(outcome.ok ? null : outcome.message ?? null);
        }}
      >
        <OfflineBadge
          offline={controller.offline}
          pending={controller.pending}
          syncing={controller.syncing}
        />
      </ExamBar>

      {message ? (
        <div style={{ marginBottom: "var(--sp-4)" }}>
          <Callout tone="danger" title="无法提交">
            {message}
          </Callout>
        </div>
      ) : null}

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
                  <ImmediateFeedback detail={null} qid={current.qid} />
                ) : null}

                <hr className="divider" />

                <div className="row">
                  <button
                    type="button"
                    className="btn"
                    disabled={paper.items.indexOf(current) === 0}
                    onClick={() => controller.goto(paper.items.indexOf(current) - 1)}
                  >
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

/** 逐题解析行。 */
function DetailRow({ detail }: { detail: GradedDetail }) {
  const statusLabel =
    detail.status === "correct"
      ? "正确"
      : detail.status === "partial"
        ? "部分正确"
        : detail.status === "wrong"
          ? "错误"
          : detail.status === "pending"
            ? "待阅"
            : "未作答";
  const tone =
    detail.status === "correct"
      ? "ok"
      : detail.status === "partial"
        ? "warn"
        : detail.status === "wrong"
          ? "danger"
          : "neutral";

  return (
    <div className="list-row" style={{ gridTemplateColumns: "64px minmax(0,1fr)" }}>
      <div>
        <Badge tone={tone}>{statusLabel}</Badge>
        <div className="text-xs text-3 num" style={{ marginTop: 4 }}>
          {detail.score}/{detail.max}
        </div>
      </div>
      <div className="list-main">
        <div className="list-title">{detail.question.stem}</div>
        <div className="list-sub">{detail.question.type}</div>
        {detail.pickedOriginal?.length ? (
          <div className="list-sub">
            你的作答：{detail.pickedDisplay?.join("、") ?? ""} · 正确答案：
            {detail.correct?.join("、") ?? ""}
          </div>
        ) : null}
        {detail.points ? <KeypointList items={detail.points.map((p) => ({ text: p.text, hit: p.hit, score: p.score, max: p.max }))} /> : null}
        {detail.steps ? (
          <KeypointList
            items={detail.steps.map((s) => ({ text: s.prompt, hit: s.hit, score: s.score, max: s.max }))}
          />
        ) : null}
        <details>
          <summary className="text-sm">查看解析</summary>
          <Analysis>
            {detail.question.analysis || detail.question.reference || "暂无解析"}
          </Analysis>
        </details>
      </div>
    </div>
  );
}

/** 即时反馈块（仅 feedback === "immediate" 的练习）。 */
function ImmediateFeedback({ detail, qid }: { detail: GradedDetail | null; qid: string }) {
  void detail;
  void qid;
  return null;
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
