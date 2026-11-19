/* ==========================================================================
   知行测评 · 管理端成绩分析
   --------------------------------------------------------------------------
   对应原型 admin.analytics。

   两种数据来源，同一套展示口径：
   - **HTTP 模式**：按**场次**读服务端的成绩分析（分数段、题型得分率、逐题
     正确率与掌握度、逐人明细）——分数段的切分与及格 / 优秀的门槛都在服务端算，
     前端不重算。
   - **mock 模式**：原型用固定种子**模拟**各答题者的答卷，保证统计结果可复现；
     已复核的分数覆盖初判分。这条路径保留在页面里。

   两处差别要注意：
   1. mock 的「名单组」筛选在 HTTP 模式没有——服务端的逐人明细不带组织路径。
   2. mock 的「按人预览」用引擎的 buildPaper；HTTP 模式读服务端的派生卷面。
   ========================================================================== */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart,
  Button,
  Dialog,
  Meter,
  PageHead,
  Segmented,
  Stat,
  formatPercent,
  formatScore,
} from "@exam/shared";
import { isBackendEnabled, previewPaper, type PaperVariant } from "@exam/shared/api";
import {
  className as classNameOf,
  getQuestion,
  plumCfgOf,
  useCatalog,
} from "@exam/shared/mock/catalog";
import {
  PAPER_MODES,
  buildPaper,
  hash32,
  rng,
  scorePaper,
  type BuiltPaper,
  type GradedPaper,
  type PaperResponses,
} from "@exam/shared/engine";
import { TypeBadge } from "../shared/bits";
import { PaperPreviewTable } from "../shared/PaperPreviewTable";
import { PaperVariantTable } from "../shared/PaperVariantTable";
import { useAdminAnalytics } from "./useAnalytics";

/** 一行成绩（mock 与 HTTP 同一形状）。 */
interface AnalyticsRow {
  studentId: string;
  studentName: string;
  className: string;
  rank: number;
  objective: number;
  subjective: number;
  total: number;
  max: number;
  /** 得分率（百分数）。 */
  rate: number;
  /** mock 模式的卷面。 */
  paper?: BuiltPaper;
}

/** 逐题统计（mock 与 HTTP 同一形状）。 */
interface QuestionStat {
  id: string;
  code: string;
  type: string;
  stem: string;
  max: number;
  /** 正确率（百分数）。 */
  correctRate: number;
  averageScore: number;
}

/** 成绩分析的展示口径（mock 与 HTTP 同一形状）。 */
interface AnalyticsView {
  /** 副标题。 */
  sub: string;
  average: number | null;
  max: number | null;
  min: number | null;
  range: number | null;
  /** 及格率（百分数）。 */
  passRate: number | null;
  /** 优秀率（百分数）。 */
  excellentRate: number | null;
  participantCount: number;
  submittedCount: number;
  absentCount: number;
  buckets: Array<{ label: string; value: number }>;
  typeStats: Array<{ type: string; label: string; rate: number }>;
  questionStats: QuestionStat[];
  roster: AnalyticsRow[];
}

/** 能力系数：由试卷 ID 与学号派生，可复现。 */
function abilityOf(studentId: string, seed: string): number {
  const r = rng(hash32(`${seed}|${studentId}|ability`));
  return 0.45 + r() * 0.5;
}

/** 模拟一名答题者的答卷。 */
function simulateResponses(
  paper: BuiltPaper,
  studentId: string,
  examId: string,
  ability: number,
): PaperResponses {
  const responses: PaperResponses = {};

  for (const item of paper.items) {
    const q = item.question;

    if (q.type === "single" || q.type === "judge") {
      const right = rng(hash32(`${examId}|${studentId}|${q.id}|r`))() < ability;
      let pick = q.answer[0] ?? "A";
      if (!right) {
        const others = (q.options ?? [])
          .map((o) => o.key)
          .filter((k) => !q.answer.includes(k));
        if (others.length > 0) {
          const rnd = rng(hash32(`${examId}|${studentId}|${q.id}|w`));
          pick = others[Math.floor(rnd() * others.length)] ?? pick;
        }
      }
      responses[q.id] = { choice: [item.fromOriginal[pick] ?? pick] };
    } else if (q.type === "multi") {
      const rnd = rng(hash32(`${examId}|${studentId}|${q.id}|m`));
      let picked = q.answer.filter(() => rnd() < ability + 0.2);
      if (picked.length === 0) picked = [q.answer[0] ?? "A"];
      responses[q.id] = { choice: picked.map((k) => item.fromOriginal[k] ?? k) };
    } else if (q.type === "short") {
      const kps = q.keypoints ?? [];
      const take = Math.max(1, Math.round(kps.length * ability));
      responses[q.id] = { text: kps.slice(0, take).map((kp) => kp.text).join("；") };
    } else {
      const steps: Record<string, string> = {};
      for (const st of q.steps ?? []) {
        const r = rng(hash32(`${examId}|${studentId}|${q.id}|${st.id}`));
        steps[st.id] = r() < ability ? st.answer : "";
      }
      responses[q.id] = { steps };
    }
  }

  return responses;
}

/** 题型中文名。 */
function typeLabel(type: string): string {
  return type === "single"
    ? "单选题"
    : type === "multi"
      ? "多选题"
      : type === "judge"
        ? "判断题"
        : type === "short"
          ? "简答题"
          : "综合操作题";
}

/** 成绩分析页。 */
export function AnalyticsPage() {
  const navigate = useNavigate();
  const remote = isBackendEnabled();

  const exams = useCatalog((state) => state.exams);
  const students = useCatalog((state) => state.students);
  const classes = useCatalog((state) => state.classes);
  const reviews = useCatalog((state) => state.reviews);

  const { sessions, statistics, sessionId, setSessionId } = useAdminAnalytics();

  const ended = useMemo(() => exams.filter((e) => e.status === "ended"), [exams]);
  const [mockExamId, setMockExamId] = useState(ended[0]?.id ?? exams[0]?.id ?? "");
  const [classFilter, setClassFilter] = useState("全部");
  // 「卷面」按人预览：打开该答题者本人的卷面（原型 admin.js:1237 openPaperPreview）。
  const [previewRow, setPreviewRow] = useState<AnalyticsRow | null>(null);
  // HTTP 模式：服务端的派生卷面。
  const [variant, setVariant] = useState<PaperVariant | null>(null);

  const exam = exams.find((e) => e.id === mockExamId);

  /* ------------------------------------------------------- mock 的模拟 */

  const mockRows = useMemo(() => {
    if (!exam) return [] as AnalyticsRow[];
    const mode = plumCfgOf(exam.id).mode;

    const built = students.map((student) => {
      const paper = buildPaper(
        exam,
        student.id,
        { mode },
        getQuestion,
        useCatalog.getState().tags.reduce<Record<string, number>>((acc, tag) => {
          if (tag.group === "difficulty" && tag.level) acc[tag.id] = tag.level;
          return acc;
        }, {}),
      );
      const ability = abilityOf(student.id, exam.id);
      const responses = simulateResponses(paper, student.id, exam.id, ability);
      const graded = scorePaper(paper, responses);
      return {
        studentId: student.id,
        studentName: student.name,
        className: classNameOf(student.classId),
        rank: 0,
        objective: graded.objective.score,
        subjective: graded.subjective.score,
        total: graded.total,
        max: graded.totalMax,
        rate: graded.totalMax > 0 ? (graded.total / graded.totalMax) * 100 : 0,
        paper,
        graded,
      } as AnalyticsRow & { graded: GradedPaper };
    });

    // 已复核的分数覆盖初判分。
    for (const review of reviews) {
      if (review.examId !== exam.id) continue;
      if (review.teacherScore === null || review.teacherScore === undefined) continue;
      const row = built.find((r) => r.studentId === review.studentId);
      if (!row) continue;
      const detail = row.graded.details.find((d) => d.qid === review.qid);
      if (!detail) continue;
      if (review.stepId) {
        const st = (detail.steps ?? []).find((s) => s.id === review.stepId);
        if (!st) continue;
        row.total = Math.round((row.total - st.score + review.teacherScore) * 100) / 100;
        st.score = review.teacherScore;
      } else {
        row.total = Math.round((row.total - detail.score + review.teacherScore) * 100) / 100;
        detail.score = review.teacherScore;
      }
      row.subjective = Math.round((row.total - row.objective) * 100) / 100;
      row.rate = row.max > 0 ? (row.total / row.max) * 100 : 0;
    }

    built.sort((a, b) => b.total - a.total);
    built.forEach((row, index) => {
      row.rank = index + 1;
    });
    return built;
  }, [exam, students, reviews]);

  const mockScoped = useMemo(() => {
    const filtered = mockRows.filter(
      (r) => classFilter === "全部" || r.className === classFilter,
    );
    return filtered.length > 0 ? filtered : mockRows;
  }, [mockRows, classFilter]);

  /* ------------------------------------------------------- 展示口径 */

  const view: AnalyticsView = useMemo(() => {
    if (remote) {
      const stats = statistics;
      if (!stats) {
        return {
          sub: "尚无场次统计。",
          average: null,
          max: null,
          min: null,
          range: null,
          passRate: null,
          excellentRate: null,
          participantCount: 0,
          submittedCount: 0,
          absentCount: 0,
          buckets: [],
          typeStats: [],
          questionStats: [],
          roster: [],
        };
      }
      const roster = [...stats.roster]
        .sort((a, b) => b.totalScore - a.totalScore)
        .map((student, index) => ({
          studentId: student.userId,
          studentName: student.displayName || student.username,
          className: "",
          rank: index + 1,
          objective: student.objectiveScore,
          subjective: student.subjectiveScore,
          total: student.totalScore,
          max: student.totalMax,
          rate: student.scoreRate,
        }));
      return {
        sub: `${stats.examSessionName} · 共 ${stats.participantCount} 名答题者（交卷 ${stats.submittedCount} 人、缺考 ${stats.absentCount} 人）。分数分布与逐题正确率来自服务端的作答统计。`,
        average: stats.averageScore,
        max: stats.maxScore,
        min: stats.minScore,
        range: stats.scoreRange,
        passRate: stats.passRate,
        excellentRate: stats.excellentRate,
        participantCount: stats.participantCount,
        submittedCount: stats.submittedCount,
        absentCount: stats.absentCount,
        buckets: stats.scoreBuckets.map((bucket) => ({
          label: bucket.label,
          value: bucket.count,
        })),
        typeStats: stats.typeStatistics.map((type) => ({
          type: type.type,
          label: type.typeLabel || typeLabel(type.type),
          rate: type.scoreRate ?? 0,
        })),
        questionStats: stats.questionStatistics.map((question) => ({
          id: question.questionId,
          code: question.code,
          type: question.type,
          stem: question.stem,
          max: question.maxScore,
          correctRate: question.correctRate ?? 0,
          averageScore: question.averageScore ?? 0,
        })),
        roster,
      };
    }

    const scores = mockScoped.map((r) => r.total);
    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const max = scores.length > 0 ? Math.max(...scores) : 0;
    const min = scores.length > 0 ? Math.min(...scores) : 0;
    const pass = mockScoped.filter((r) => r.max > 0 && r.total / r.max >= 0.6).length;
    const excellent = mockScoped.filter((r) => r.max > 0 && r.total / r.max >= 0.85).length;

    const buckets = [
      { label: "90 分以上", value: mockScoped.filter((r) => r.max > 0 && r.total / r.max >= 0.9).length },
      { label: "80–90", value: mockScoped.filter((r) => r.max > 0 && r.total / r.max >= 0.8 && r.total / r.max < 0.9).length },
      { label: "70–80", value: mockScoped.filter((r) => r.max > 0 && r.total / r.max >= 0.7 && r.total / r.max < 0.8).length },
      { label: "60–70", value: mockScoped.filter((r) => r.max > 0 && r.total / r.max >= 0.6 && r.total / r.max < 0.7).length },
      { label: "60 分以下", value: mockScoped.filter((r) => r.max > 0 && r.total / r.max < 0.6).length },
    ];

    const questionMap = new Map<
      string,
      { qid: string; stem: string; type: string; max: number; correct: number; total: number; score: number }
    >();
    for (const row of mockScoped) {
      const graded = (row as AnalyticsRow & { graded: GradedPaper }).graded;
      for (const detail of graded.details) {
        let stat = questionMap.get(detail.qid);
        if (!stat) {
          stat = {
            qid: detail.qid,
            stem: detail.question.stem,
            type: detail.type,
            max: detail.max,
            correct: 0,
            total: 0,
            score: 0,
          };
          questionMap.set(detail.qid, stat);
        }
        stat.total += 1;
        stat.score += detail.score;
        const full = detail.type === "short" || detail.type === "comprehensive";
        if (full ? detail.score >= detail.max - 0.001 : detail.status === "correct") {
          stat.correct += 1;
        }
      }
    }

    const typeMap = new Map<string, { score: number; max: number }>();
    for (const row of mockScoped) {
      const graded = (row as AnalyticsRow & { graded: GradedPaper }).graded;
      for (const detail of graded.details) {
        const entry = typeMap.get(detail.type) ?? { score: 0, max: 0 };
        entry.score += detail.score;
        entry.max += detail.max;
        typeMap.set(detail.type, entry);
      }
    }

    const mode = exam ? plumCfgOf(exam.id).mode : "standard";
    return {
      sub: `${exam?.name ?? ""} · ${PAPER_MODES[mode].label} · 共 ${mockScoped.length} 名答题者。分数分布与逐题正确率基于各卷作答统计，主观题已合并复核分。`,
      average: avg,
      max,
      min,
      range: max - min,
      passRate: mockScoped.length > 0 ? (pass / mockScoped.length) * 100 : 0,
      excellentRate: mockScoped.length > 0 ? (excellent / mockScoped.length) * 100 : 0,
      participantCount: mockScoped.length,
      submittedCount: mockScoped.length,
      absentCount: 0,
      buckets,
      typeStats: [...typeMap.entries()].map(([type, v]) => ({
        type,
        label: typeLabel(type),
        rate: v.max > 0 ? Math.round((v.score / v.max) * 1000) / 10 : 0,
      })),
      questionStats: [...questionMap.values()].map((stat) => ({
        id: stat.qid,
        code: stat.qid,
        type: stat.type,
        stem: stat.stem,
        max: stat.max,
        correctRate: stat.total > 0 ? (stat.correct / stat.total) * 100 : 0,
        averageScore: stat.total > 0 ? stat.score / stat.total : 0,
      })),
      roster: mockScoped,
    };
  }, [remote, statistics, mockScoped, exam]);

  /* ------------------------------------------------------- 按人预览 */

  /** 打开某人的卷面预览（HTTP 模式读服务端的派生卷面）。 */
  const openPreview = async (row: AnalyticsRow) => {
    setPreviewRow(row);
    if (!remote) return;
    const session = sessions.find((item) => item.id === sessionId);
    if (!session?.paperId) {
      setVariant(null);
      return;
    }
    try {
      const result = await previewPaper(session.paperId, row.studentId);
      setVariant(result);
    } catch {
      setVariant(null);
    }
  };

  /* ------------------------------------------------------------ 渲染 */

  if (remote && sessions.length === 0) {
    return (
      <PageHead
        title="成绩分析"
        sub="尚无场次。发布试卷并创建考试场次后，这里会给出该场次的成绩分析。"
        actions={
          <Button onClick={() => navigate("/exam-sessions")}>去考试场次</Button>
        }
      />
    );
  }

  if (!remote && !exam) {
    return (
      <PageHead
        title="成绩分析"
        sub="尚无可分析的试卷。"
        actions={
          <Button onClick={() => navigate("/papers")}>去组卷</Button>
        }
      />
    );
  }

  return (
    <>
      <PageHead
        title="成绩分析"
        sub={view.sub}
        actions={
          remote ? (
            <Button onClick={() => navigate("/exam-sessions")}>查看考试场次</Button>
          ) : (
            <Button
              onClick={() =>
                exam ? navigate(`/papers/${exam.id}?kind=exam&step=plum`) : navigate("/papers")
              }
            >
              查看卷面矩阵
            </Button>
          )
        }
      />

      <section className="card" style={{ marginBottom: "var(--sp-4)" }}>
        <div className="card-body">
          {remote ? (
            <div className="row">
              <span className="text-sm text-3">考试场次</span>
              <Segmented
                label="场次筛选"
                value={sessionId}
                onChange={setSessionId}
                options={sessions.map((session) => ({
                  value: session.id,
                  label: session.name,
                }))}
              />
            </div>
          ) : (
            <>
              <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
                <span className="text-sm text-3">名单组</span>
                <Segmented
                  label="名单组筛选"
                  value={classFilter}
                  onChange={setClassFilter}
                  options={["全部", ...classes.map((c) => c.name)].map((name) => ({
                    value: name,
                    label: name,
                  }))}
                />
              </div>
              <div className="row">
                <span className="text-sm text-3">试卷</span>
                <Segmented
                  label="试卷筛选"
                  value={mockExamId}
                  onChange={setMockExamId}
                  options={ended.map((e) => ({ value: e.id, label: e.name }))}
                />
              </div>
            </>
          )}
        </div>
      </section>

      <div className="stat-row" style={{ marginBottom: "var(--sp-4)" }}>
        <Stat
          label="平均分"
          value={view.average === null ? "—" : formatScore(view.average)}
          unit="分"
          hint={`满分 ${formatScore(view.roster[0]?.max ?? 0)} 分`}
        />
        <Stat
          label="最高 / 最低"
          value={
            view.max === null || view.min === null
              ? "—"
              : `${formatScore(view.max)} / ${formatScore(view.min)}`
          }
          unit="分"
          hint={`极差 ${view.range === null ? "—" : formatScore(view.range)} 分`}
        />
        <Stat
          label="及格率"
          value={view.passRate === null ? "—" : formatPercent(view.passRate)}
          unit="%"
          hint={`${view.submittedCount} / ${view.participantCount} 人`}
        />
        <Stat
          label="优秀率"
          value={view.excellentRate === null ? "—" : formatPercent(view.excellentRate)}
          unit="%"
          hint={`缺考 ${view.absentCount} 人`}
        />
      </div>

      <div className="split" style={{ marginBottom: "var(--sp-4)" }}>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">成绩明细</h2>
            <span className="text-sm text-3">按总分降序</span>
          </div>
          <div className="card-body is-flush">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">总排名</th>
                    <th scope="col">答题者</th>
                    <th scope="col">客观题</th>
                    <th scope="col">主观题</th>
                    <th scope="col">总分</th>
                    <th scope="col">得分率</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {view.roster.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="empty">
                          <span className="empty-title">还没有成绩记录</span>
                          <span className="empty-body">交卷后这里会给出逐人明细。</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    view.roster.map((r) => (
                      <tr key={r.studentId}>
                        <td className="num">{r.rank}</td>
                        <td>
                          <div className="strong" style={{ fontWeight: 600 }}>
                            {r.studentName}
                          </div>
                          {r.className ? (
                            <div className="text-xs text-3">{r.className}</div>
                          ) : null}
                        </td>
                        <td className="num">{formatScore(r.objective)}</td>
                        <td className="num">{formatScore(r.subjective)}</td>
                        <td className="num strong" style={{ fontWeight: 600 }}>
                          {formatScore(r.total)} / {formatScore(r.max)}
                        </td>
                        <td>
                          <Meter
                            value={r.rate}
                            max={100}
                            tone={r.rate >= 85 ? "ok" : r.rate >= 60 ? "warn" : "danger"}
                          />
                        </td>
                        <td className="col-actions">
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => void openPreview(r)}
                          >
                            卷面
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">分数段分布</h2>
            </div>
            <div className="card-body">
              <BarChart data={view.buckets} title="分数段分布" />
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">题型得分率</h2>
            </div>
            <div className="card-body">
              {view.typeStats.map((t) => (
                <div className="bar-row" key={t.type}>
                  <span className="od-truncate">{t.label}</span>
                  <span className="bar-track">
                    <span
                      className="bar-fill is-warn"
                      style={{ width: `${Math.round(t.rate)}%` }}
                    />
                  </span>
                  <span className="right num text-sm">{Math.round(t.rate)}%</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">逐题正确率</h2>
          <span className="text-sm text-3">正确率低于 60% 的题目建议安排讲评</span>
        </div>
        <div className="card-body is-flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">题号</th>
                  <th scope="col">题型</th>
                  <th scope="col">题干</th>
                  <th scope="col">满分</th>
                  <th scope="col">正确率</th>
                  <th scope="col">平均得分</th>
                  <th scope="col">掌握度</th>
                </tr>
              </thead>
              <tbody>
                {view.questionStats.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty">
                        <span className="empty-title">还没有逐题数据</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  view.questionStats.map((s) => (
                    <tr key={s.id}>
                      <td className="mono text-xs">{s.code || s.id}</td>
                      <td>
                        <TypeBadge type={s.type} />
                      </td>
                      <td>
                        <div className="od-truncate" style={{ maxWidth: 320 }}>
                          {s.stem}
                        </div>
                      </td>
                      <td className="num">{formatScore(s.max)}</td>
                      <td className="num">{formatPercent(s.correctRate)}%</td>
                      <td className="num">{formatScore(s.averageScore)}</td>
                      <td>
                        <Meter
                          value={s.correctRate}
                          max={100}
                          tone={
                            s.correctRate >= 80 ? "ok" : s.correctRate >= 60 ? "warn" : "danger"
                          }
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <Dialog
        open={previewRow !== null}
        onClose={() => {
          setPreviewRow(null);
          setVariant(null);
        }}
        title={
          previewRow
            ? `${previewRow.studentName} · ${remote ? statistics?.examSessionName ?? "" : exam?.name ?? ""}`
            : "卷面预览"
        }
        className="dlg-wide"
      >
        {previewRow ? (
          remote ? (
            variant ? (
              <PaperVariantTable variant={variant} />
            ) : (
              <p className="section-note">没有可预览的卷面（服务端只为已发布的试卷生成卷面）。</p>
            )
          ) : previewRow.paper ? (
            <>
              <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
                <span className="variant-tag">{previewRow.paper.variantLabel}</span>
                <span className="text-sm text-3">
                  卷型 {PAPER_MODES[previewRow.paper.mode].label} · 置换号{" "}
                  {previewRow.paper.seedLabel}（系统自动生成）· {previewRow.className} ·{" "}
                  {previewRow.studentId}
                </span>
              </div>
              <PaperPreviewTable
                paper={previewRow.paper}
                showBase={previewRow.paper.mode === "large"}
              />
            </>
          ) : null
        ) : null}
      </Dialog>
    </>
  );
}
