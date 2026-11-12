/* ==========================================================================
   知行测评 · 管理端成绩分析
   --------------------------------------------------------------------------
   对应原型 admin.analytics。

   原型用固定种子**模拟**各答题者的答卷，保证统计结果可复现；已复核的分数
   覆盖初判分。本实现沿用同一口径：模拟 + 复核覆盖，数据源换成真实作答记录。
   ========================================================================== */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart, Meter, PageHead, Segmented, Stat, formatPercent, formatScore } from "@exam/shared";
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

/** 一行成绩。 */
interface AnalyticsRow {
  studentId: string;
  studentName: string;
  className: string;
  rank: number;
  objective: number;
  subjective: number;
  total: number;
  max: number;
  paper: BuiltPaper;
  graded: GradedPaper;
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

/** 成绩分析页。 */
export function AnalyticsPage() {
  const navigate = useNavigate();
  const exams = useCatalog((state) => state.exams);
  const students = useCatalog((state) => state.students);
  const classes = useCatalog((state) => state.classes);
  const reviews = useCatalog((state) => state.reviews);

  const ended = useMemo(() => exams.filter((e) => e.status === "ended"), [exams]);
  const [examId, setExamId] = useState(ended[0]?.id ?? exams[0]?.id ?? "");
  const [classFilter, setClassFilter] = useState("全部");

  const exam = exams.find((e) => e.id === examId);

  const rows = useMemo(() => {
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
        paper,
        graded,
      };
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
    }

    built.sort((a, b) => b.total - a.total);
    built.forEach((row, index) => {
      row.rank = index + 1;
    });
    return built;
  }, [exam, students, reviews]);

  const scoped = useMemo(() => {
    const filtered = rows.filter((r) => classFilter === "全部" || r.className === classFilter);
    return filtered.length > 0 ? filtered : rows;
  }, [rows, classFilter]);

  // 无试卷时给空快照，保证 hooks 调用顺序稳定。
  const questionStats = useMemo(() => {
    const map = new Map<string, { qid: string; stem: string; type: string; max: number; correct: number; total: number; score: number }>();
    for (const row of scoped) {
      for (const detail of row.graded.details) {
        let stat = map.get(detail.qid);
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
          map.set(detail.qid, stat);
        }
        stat.total += 1;
        stat.score += detail.score;
        const full = detail.type === "short" || detail.type === "comprehensive";
        if (full ? detail.score >= detail.max - 0.001 : detail.status === "correct") {
          stat.correct += 1;
        }
      }
    }
    return [...map.values()];
  }, [scoped]);

  // 题型得分率。
  const typeStats = useMemo(() => {
    const map = new Map<string, { score: number; max: number }>();
    for (const row of scoped) {
      for (const detail of row.graded.details) {
        const entry = map.get(detail.type) ?? { score: 0, max: 0 };
        entry.score += detail.score;
        entry.max += detail.max;
        map.set(detail.type, entry);
      }
    }
    return [...map.entries()].map(([type, v]) => ({
      type,
      rate: v.max > 0 ? Math.round((v.score / v.max) * 1000) / 10 : 0,
    }));
  }, [scoped]);

  if (!exam) {
    return (
      <PageHead
        title="成绩分析"
        sub="尚无可分析的试卷。"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => navigate("/papers")}>
            去组卷
          </button>
        }
      />
    );
  }

  const scores = scoped.map((r) => r.total);
  const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const max = scores.length > 0 ? Math.max(...scores) : 0;
  const min = scores.length > 0 ? Math.min(...scores) : 0;
  const pass = scoped.filter((r) => r.max > 0 && r.total / r.max >= 0.6).length;
  const excellent = scoped.filter((r) => r.max > 0 && r.total / r.max >= 0.85).length;

  const bands = [
    { label: "90 分以上", value: scoped.filter((r) => r.max > 0 && r.total / r.max >= 0.9).length },
    { label: "80–90", value: scoped.filter((r) => r.max > 0 && r.total / r.max >= 0.8 && r.total / r.max < 0.9).length },
    { label: "70–80", value: scoped.filter((r) => r.max > 0 && r.total / r.max >= 0.7 && r.total / r.max < 0.8).length },
    { label: "60–70", value: scoped.filter((r) => r.max > 0 && r.total / r.max >= 0.6 && r.total / r.max < 0.7).length },
    { label: "60 分以下", value: scoped.filter((r) => r.max > 0 && r.total / r.max < 0.6).length },
  ];

  const mode = plumCfgOf(exam.id).mode;

  return (
    <>
      <PageHead
        title="成绩分析"
        sub={`${exam.name} · ${PAPER_MODES[mode].label} · 共 ${scoped.length} 名答题者。分数分布与逐题正确率基于各卷作答统计，主观题已合并复核分。`}
        actions={
          <button
            type="button"
            className="btn"
            onClick={() => navigate(`/papers/${exam.id}?kind=exam&step=plum`)}
          >
            查看卷面矩阵
          </button>
        }
      />

      <section className="card" style={{ marginBottom: "var(--sp-4)" }}>
        <div className="card-body">
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
              value={examId}
              onChange={setExamId}
              options={ended.map((e) => ({ value: e.id, label: e.name }))}
            />
          </div>
        </div>
      </section>

      <div className="stat-row" style={{ marginBottom: "var(--sp-4)" }}>
        <Stat
          label="平均分"
          value={formatScore(avg)}
          unit="分"
          hint={`满分 ${formatScore(scoped[0]?.max ?? 0)} 分`}
        />
        <Stat
          label="最高 / 最低"
          value={`${formatScore(max)} / ${formatScore(min)}`}
          unit="分"
          hint={`极差 ${formatScore(max - min)} 分`}
        />
        <Stat
          label="及格率"
          value={formatPercent(scoped.length > 0 ? (pass / scoped.length) * 100 : 0)}
          unit="%"
          hint={`${pass} / ${scoped.length} 人`}
        />
        <Stat
          label="优秀率"
          value={formatPercent(scoped.length > 0 ? (excellent / scoped.length) * 100 : 0)}
          unit="%"
          hint={`${excellent} / ${scoped.length} 人`}
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
                    <th>总排名</th>
                    <th>答题者</th>
                    <th>客观题</th>
                    <th>主观题</th>
                    <th>总分</th>
                    <th>得分率</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {scoped.map((r) => {
                    const pct = r.max > 0 ? (r.total / r.max) * 100 : 0;
                    return (
                      <tr key={r.studentId}>
                        <td className="num">{r.rank}</td>
                        <td>
                          <div className="strong" style={{ fontWeight: 600 }}>
                            {r.studentName}
                          </div>
                          <div className="text-xs text-3">{r.className}</div>
                        </td>
                        <td className="num">{formatScore(r.objective)}</td>
                        <td className="num">{formatScore(r.subjective)}</td>
                        <td className="num strong" style={{ fontWeight: 600 }}>
                          {formatScore(r.total)} / {formatScore(r.max)}
                        </td>
                        <td>
                          <Meter
                            value={pct}
                            max={100}
                            tone={pct >= 85 ? "ok" : pct >= 60 ? "warn" : "danger"}
                          />
                        </td>
                        <td className="col-actions">
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => navigate(`/papers/${exam.id}?kind=exam&step=plum`)}
                          >
                            卷面
                          </button>
                        </td>
                      </tr>
                    );
                  })}
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
              <BarChart data={bands} title="分数段分布" />
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">题型得分率</h2>
            </div>
            <div className="card-body">
              {typeStats.map((t) => (
                <div className="bar-row" key={t.type}>
                  <span className="od-truncate">
                    {t.type === "single"
                      ? "单选题"
                      : t.type === "multi"
                        ? "多选题"
                        : t.type === "judge"
                          ? "判断题"
                          : t.type === "short"
                            ? "简答题"
                            : "综合操作题"}
                  </span>
                  <span className="bar-track">
                    <span
                      className={`bar-fill${t.rate >= 80 ? "" : t.rate >= 60 ? " is-warn" : " is-danger"}`}
                      style={{ width: `${Math.round(t.rate)}%` }}
                    />
                  </span>
                  <span className="right num text-sm">{t.rate}%</span>
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
                  <th>题号</th>
                  <th>题型</th>
                  <th>题干</th>
                  <th>满分</th>
                  <th>正确率</th>
                  <th>平均得分</th>
                  <th>掌握度</th>
                </tr>
              </thead>
              <tbody>
                {questionStats.map((s) => {
                  const rate = s.total > 0 ? (s.correct / s.total) * 100 : 0;
                  const avgScore = s.total > 0 ? s.score / s.total : 0;
                  return (
                    <tr key={s.qid}>
                      <td className="mono text-xs">{s.qid}</td>
                      <td>
                        <TypeBadge type={s.type} />
                      </td>
                      <td>
                        <div className="od-truncate" style={{ maxWidth: 320 }}>
                          {s.stem}
                        </div>
                      </td>
                      <td className="num">{formatScore(s.max)}</td>
                      <td className="num">{formatPercent(rate)}%</td>
                      <td className="num">{formatScore(avgScore)}</td>
                      <td>
                        <Meter
                          value={rate}
                          max={100}
                          tone={rate >= 80 ? "ok" : rate >= 60 ? "warn" : "danger"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
