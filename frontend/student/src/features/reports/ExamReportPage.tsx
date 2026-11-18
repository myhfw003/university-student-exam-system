/* ==========================================================================
   知行测评 · 学生端单场成绩报告
   --------------------------------------------------------------------------
   对应原型 student.report。三种情形：
     A. 有本次作答记录 → 客观/主观得分、题型得分、逐题明细；
     B. 无记录但考试已结束 → 试卷回顾（题目与解析，无个人作答）；
     C. 都没有 → 暂未参加该考试。
   ========================================================================== */

import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Empty, PageHead, Stat } from "@exam/shared";
import { formatPercent, formatScore, formatTime } from "@exam/shared";
import { buildPaper, TYPE_LABEL } from "@exam/shared/engine/paper";
import { applyTeacherScores, scorePaper } from "@exam/shared/engine/scoring";
import { difficultyLevels, getQuestion, itemsOf, useCatalog } from "@exam/shared/mock/catalog";
import type { Question } from "@exam/shared/domain/types";
import { dataSourceMode } from "@exam/shared/api";
import { useStudentStore } from "@/stores/studentStore";
import { GradedDetailRow } from "@/features/shared/GradedDetailRow";
import { TagChips } from "@/features/shared/TagChips";

/** 成绩报告详情。 */
export function ExamReportPage() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const studentId = useStudentStore((state) => state.studentId);

  const exams = useCatalog((state) => state.exams);
  const students = useCatalog((state) => state.students);
  const attempts = useCatalog((state) => state.attempts);
  const reviews = useCatalog((state) => state.reviews);
  const questions = useCatalog((state) => state.questions);
  const records = useCatalog((state) => state.records);

  const exam = useMemo(() => exams.find((e) => e.id === sessionId), [exams, sessionId]);

  const attempt = useMemo(
    () =>
      Object.values(attempts).find(
        (a) => a.studentId === studentId && a.examId === sessionId,
      ),
    [attempts, studentId, sessionId],
  );

  /* ------------------------------------------------------- 重算成绩 */

  const graded = useMemo(() => {
    if (!exam || !attempt) return null;
    const paper = buildPaper(exam, studentId, undefined, getQuestion, difficultyLevels());
    const raw = scorePaper(paper, attempt.responses);
    const teacherRecords = reviews
      .filter((r) => r.examId === exam.id && r.studentId === studentId)
      .map((r) => ({
        qid: r.qid,
        stepId: r.stepId,
        attempt: r.attempt,
        teacherScore: r.teacherScore,
        status: r.status,
      }));
    return applyTeacherScores(raw, teacherRecords, attempt.attemptNo);
  }, [exam, attempt, studentId, reviews]);

  if (!exam) {
    // HTTP 模式下报告页还没接后端（任务 T-P10-02）：说清楚，别报「报告不存在」。
    const pending = dataSourceMode() === "http";
    return (
      <Card>
        <Empty
          title={pending ? "成绩报告尚未接入" : "报告不存在"}
          body={
            pending
              ? "本场考试已交卷，成绩报告的数据正在接入；在此之前可先返回考试安排。"
              : "请返回成绩报告列表重新选择。"
          }
          action={
            <Button variant="primary" onClick={() => navigate("/exams")}>
              返回考试安排
            </Button>
          }
        />
      </Card>
    );
  }

  // 原型 student.js:1390：副标题末尾带「姓名 学号」。
  const studentName = students.find((s) => s.id === studentId)?.name ?? studentId;

  const modeLabel =
    exam.plum.mode === "standard" ? "标准卷" : exam.plum.mode === "small" ? "小梅花" : "大梅花";
  const modeShort =
    exam.plum.mode === "standard"
      ? "题序 · 选项均固定"
      : exam.plum.mode === "small"
        ? "选项随机 · 题序保留"
        : "题型分块 · 组内题序随机";

  /* --------------------------------------------- B. 历史成绩（无作答记录） */

  const history = records.find((r) => r.examId === exam.id && r.studentId === studentId);

  if (!attempt) {
    if (!history) {
      return (
        <Card>
          <Empty
            title="暂未参加该考试"
            body="本场考试未开放给当前答题者，或尚未生成成绩。"
          />
        </Card>
      );
    }

    // 原型 student.js:1374：回顾按**卷面条目**（itemsOf）走，
    // 分值取条目分值而不是题目默认分值。
    const items_ = itemsOf(exam);
    const questions_ = items_
      .map((item) => ({ item, question: questions.find((q) => q.id === item.qid) }))
      .filter((x): x is { item: (typeof items_)[number]; question: Question } =>
        x.question !== undefined,
      );

    return (
      <>
        <PageHead
          title={exam.name}
          sub={`${exam.batch || "—"} · 卷型：${modeLabel}（${modeShort}） · ${studentName} ${studentId}`}
          actions={
            <>
              <div className="row-tight">
                <TagChips tags={exam.tags} />
              </div>
              <Button onClick={() => navigate("/reports")}>返回报告列表</Button>
            </>
          }
        />

        <div className="stat-row">
          <Stat label="本卷得分" value={history.score} unit="分" hint={`满分 ${history.total} 分`} />
          <Stat
            label="得分率"
            value={formatPercent(history.total > 0 ? (history.score / history.total) * 100 : 0)}
            unit="%"
            hint="成绩已发布"
          />
          <Stat label="考试日期" value={history.date} hint={exam.batch || "—"} />
          <Stat label="卷型" value={modeLabel} hint={modeShort} />
        </div>

        <section className="card" style={{ marginTop: "var(--sp-5)" }}>
          <div className="card-head">
            <h2 className="card-title">试卷回顾</h2>
          </div>
          <div className="card-body">
            <p className="section-note">
              本场为已结束的考试，此处提供题目与解析回顾，不含个人逐题作答记录。
            </p>
            {questions_.map(({ item, question }, index) => (
              <div
                className="list-row"
                key={question.id}
                style={{ gridTemplateColumns: "64px minmax(0,1fr)" }}
              >
                <div className="q-index">第 {index + 1} 题</div>
                <div className="list-main">
                  <div className="list-title">{question.stem}</div>
                  <div className="list-sub">
                    {TYPE_LABEL[question.type] ?? question.type} · {item.score} 分
                  </div>
                  <div className="row-tight">
                    <TagChips tags={question.tags} />
                  </div>
                  {question.options && question.options.length > 0 ? (
                    <div className="list-sub">
                      选项：
                      {question.options
                        .map((o) => `${o.key}. ${o.text}`)
                        .join("　")}
                    </div>
                  ) : null}
                  <details>
                    <summary className="text-sm">查看答案与解析</summary>
                    <div className="analysis">
                      答案：{question.answer.join("、") || "—"}
                      <br />
                      {question.reference ? (
                        <>
                          <br />
                          参考答案：{question.reference}
                        </>
                      ) : null}
                      {question.analysis ? (
                        <>
                          <br />
                          解析：{question.analysis}
                        </>
                      ) : null}
                    </div>
                  </details>
                </div>
              </div>
            ))}
          </div>
        </section>
      </>
    );
  }

  /* ------------------------------------------------- A. 有本次作答记录 */

  const typeScores = new Map<string, { score: number; max: number }>();
  for (const detail of graded?.details ?? []) {
    const entry = typeScores.get(detail.type) ?? { score: 0, max: 0 };
    entry.score += detail.score;
    entry.max += detail.max;
    typeScores.set(detail.type, entry);
  }

  return (
    <>
      <PageHead
        title={exam.name}
        sub={`${exam.batch || "—"} · 卷型：${modeLabel}（${modeShort}） · ${studentName} ${studentId}`}
        actions={
          <>
            <div className="row-tight">
              <TagChips tags={exam.tags} />
            </div>
            <Button onClick={() => navigate("/reports")}>返回报告列表</Button>
          </>
        }
      />

      <div className="stat-row">
        <Stat
          label="客观题得分"
          value={formatScore(graded?.objective.score ?? 0)}
          unit="分"
          hint={`满分 ${graded?.objective.max ?? 0} 分，自动判分`}
        />
        <Stat
          label="主观题得分"
          value={formatScore(graded?.subjective.score ?? 0)}
          unit="分"
          hint={
            graded && graded.pendingQuestions.length > 0
              ? `满分 ${graded.subjective.max} 分，${graded.pendingQuestions.length} 题待阅`
              : `满分 ${graded?.subjective.max ?? 0} 分，已复核`
          }
        />
        <Stat
          label="当前总分"
          value={formatScore(graded?.total ?? 0)}
          unit="分"
          hint={`满分 ${graded?.totalMax ?? 0} 分`}
        />
        <Stat
          label="交卷时间"
          value={formatTime(attempt.submittedAt)}
          hint={`卷号 ${attempt.variantLabel || modeLabel}`}
        />
      </div>

      <section className="card" style={{ marginTop: "var(--sp-5)" }}>
        <div className="card-head">
          <h2 className="card-title">题型得分</h2>
        </div>
        <div className="card-body">
          {[...typeScores.entries()].map(([type, value]) => {
            const rate = value.max > 0 ? (value.score / value.max) * 100 : 0;
            return (
              <div className="bar-row" key={type}>
                <span className="od-truncate">{TYPE_LABEL[type as keyof typeof TYPE_LABEL] ?? type}</span>
                <span className="bar-track">
                  <span
                    className={`bar-fill${rate >= 80 ? "" : rate >= 60 ? " is-warn" : " is-danger"}`}
                    style={{ width: `${Math.round(rate)}%` }}
                  />
                </span>
                <span className="right num text-sm">
                  {value.score}/{value.max}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card" style={{ marginTop: "var(--sp-5)" }}>
        <div className="card-head">
          <h2 className="card-title">逐题明细</h2>
          <span className="text-sm text-3">共 {graded?.details.length ?? 0} 题</span>
        </div>
        <div className="card-body is-flush">
          {(graded?.details ?? []).map((detail) => (
            <GradedDetailRow key={detail.qid} detail={detail} variant="report" />
          ))}
        </div>
      </section>
    </>
  );
}
