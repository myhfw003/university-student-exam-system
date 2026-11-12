/* ==========================================================================
   知行测评 · 学生端工作台
   --------------------------------------------------------------------------
   对应原型 student.dashboard：问候语、四个统计卡、进行中的考试、
   推荐练习、最近成绩、成绩趋势、错题分布。
   ========================================================================== */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, Empty, LineChart, PageHead, Stat, TagChip } from "@exam/shared";
import { formatPercent, formatScore } from "@exam/shared";
import { getStudent, useCatalog } from "@exam/shared/mock/catalog";
import { useStudentStore } from "@/stores/studentStore";
import {
  greetingFor,
  useOngoingExam,
  useStudentMistakes,
  useStudentRecords,
  useVisiblePractices,
  weekdayOf,
} from "@/features/shared/studentData";

/** 工作台。 */
export function DashboardPage() {
  const navigate = useNavigate();
  const studentId = useStudentStore((state) => state.studentId);
  const students = useCatalog((state) => state.students);
  const exams = useCatalog((state) => state.exams);
  const practices = useCatalog((state) => state.practices);

  const student = useMemo(
    () => students.find((s) => s.id === studentId) ?? getStudent(studentId),
    [students, studentId],
  );
  const className = useMemo(() => {
    const group = useCatalog.getState().classes.find((c) => c.id === student?.classId);
    return group?.name ?? "未分班";
  }, [student]);

  const records = useStudentRecords();
  const mistakes = useStudentMistakes();
  const practices_ = useVisiblePractices();
  const ongoing = useOngoingExam();

  const now = new Date();
  const greeting = greetingFor(now.getHours());

  /* ---------------------------------------------------------- 统计 */

  const pendingPractices = practices_.filter((p) => p.status === "published").length;
  const average = useMemo(() => {
    if (records.length === 0) return 0;
    const rates = records.map((r) => (r.total > 0 ? (r.score / r.total) * 100 : 0));
    return rates.reduce((a, b) => a + b, 0) / rates.length;
  }, [records]);

  const mistakeKnowledgePoints = new Set(
    mistakes.flatMap((m) => {
      const question = useCatalog.getState().questions.find((q) => q.id === m.qid);
      return (question?.tags ?? []).filter((t) => t.startsWith("t-pt-"));
    }),
  ).size;

  /* ------------------------------------------------------ 成绩趋势 */

  const trend = useMemo(() => {
    const recent = records.slice(0, 6).reverse();
    return recent.map((r) => ({
      label: r.date.slice(5),
      value: r.total > 0 ? Math.round((r.score / r.total) * 100) : 0,
    }));
  }, [records]);

  /* ------------------------------------------------------ 错题分布 */

  const mistakeDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const mistake of mistakes) {
      const question = useCatalog.getState().questions.find((q) => q.id === mistake.qid);
      const tagId = question?.tags.find((t) => t.startsWith("t-pt-"));
      if (!tagId) continue;
      counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
    }
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const max = entries.length > 0 ? entries[0]![1] : 0;
    return entries.map(([tagId, count]) => ({
      tagId,
      name: useCatalog.getState().tags.find((t) => t.id === tagId)?.name ?? tagId,
      count,
      tone: count === max ? ("default" as const) : ("warn" as const),
    }));
  }, [mistakes]);

  return (
    <>
      <PageHead
        title={`${greeting}，${student?.name ?? studentId}`}
        sub={`${className} · 编号 ${studentId} · 今天 ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 ${weekdayOf(now)}`}
        actions={
          <>
            <Button onClick={() => navigate("/exams")}>考试安排</Button>
            <Button variant="primary" onClick={() => navigate("/practice")}>
              去练习
            </Button>
          </>
        }
      />

      <div className="stat-row">
        <Stat label="待完成练习" value={pendingPractices} unit="项" hint={`共 ${practices_.length} 个练习项目`} />
        <Stat
          label="进行中考试"
          value={ongoing ? 1 : 0}
          unit="场"
          hint={ongoing?.name ?? "暂无安排"}
        />
        <Stat
          label="学期平均分"
          value={formatScore(average)}
          unit="分"
          hint={`按百分制折算，共 ${records.length} 条记录`}
        />
        <Stat
          label="待订正错题"
          value={mistakes.length}
          unit="题"
          hint={`来自 ${mistakeKnowledgePoints} 个知识点`}
        />
      </div>

      <div className="split" style={{ marginTop: "var(--sp-5)" }}>
        <div className="stack">
          {/* 进行中的考试 */}
          {ongoing ? (
            <Card
              title="进行中的考试"
              actions={<Badge tone="warn">考试进行中</Badge>}
            >
              <div className="row">
                <div className="list-main">
                  <div className="list-title">{ongoing.name}</div>
                  <div className="list-sub">
                    {ongoing.batch || "—"} · {ongoing.durationMin} 分钟 · 总分{" "}
                    {ongoing.totalScore} 分 · 开放时间 {ongoing.openAt} — {ongoing.closeAt}
                  </div>
                  <div className="row-tight">
                    <span className="variant-tag">
                      {ongoing.plum.mode === "standard"
                        ? "标准卷"
                        : ongoing.plum.mode === "small"
                          ? "小梅花"
                          : "大梅花"}
                    </span>
                    <span className="text-sm text-3">
                      你的卷号 {studentId.slice(-4)} 号卷
                    </span>
                  </div>
                  <div className="row-tight">
                    {ongoing.tags.map((tagId) => (
                      <TagChip key={tagId} group="domain">
                        {useCatalog.getState().tags.find((t) => t.id === tagId)?.name ?? tagId}
                      </TagChip>
                    ))}
                  </div>
                </div>
                <div className="spacer" />
                <Button variant="primary" onClick={() => navigate(`/exams/${ongoing.id}`)}>
                  进入考试
                </Button>
              </div>
              <div className="callout" style={{ marginTop: "var(--sp-4)" }}>
                <span className="callout-title">考试须知</span>
                <span>{ongoing.note}</span>
              </div>
            </Card>
          ) : null}

          {/* 推荐练习 */}
          <Card
            title="推荐练习"
            actions={
              <Button size="sm" onClick={() => navigate("/practice")}>
                全部练习
              </Button>
            }
          >
            {practices_.length === 0 ? (
              <Empty title="暂无练习" body="内容管理员上架练习后会显示在这里。" />
            ) : (
              practices_.slice(0, 4).map((practice) => {
                const result = records.find((r) => r.kind === "practice" && r.id === practice.id);
                return (
                  <div className="list-row" key={practice.id}>
                    <div className="list-main">
                      <div className="list-title">{practice.name}</div>
                      <div className="list-sub">
                        {practice.questionIds.length} 题 · 约 {practice.durationMin} 分钟 · 总分{" "}
                        {practice.totalScore} 分
                      </div>
                      {result ? (
                        <div className="list-sub">
                          上次得分 {result.score}/{result.total}（
                          {formatPercent(result.total > 0 ? (result.score / result.total) * 100 : 0)}%）
                        </div>
                      ) : (
                        <div className="list-sub">尚未开始</div>
                      )}
                    </div>
                    <div className="spacer" />
                    <Button size="sm" onClick={() => navigate(`/practice/${practice.id}`)}>
                      {result ? "再练一次" : "开始练习"}
                    </Button>
                  </div>
                );
              })
            )}
          </Card>

          {/* 最近成绩 */}
          <Card
            title="最近成绩"
            actions={
              <Button size="sm" onClick={() => navigate("/reports")}>
                全部报告
              </Button>
            }
          >
            {records.length === 0 ? (
              <Empty
                title="暂无成绩记录"
                body="完成一次练习或考试后，这里会显示成绩变化曲线。"
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>项目</th>
                      <th>日期</th>
                      <th className="right">得分</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.slice(0, 5).map((record) => (
                      <tr key={`${record.kind}-${record.id}`}>
                        <td>
                          <div className="strong">{record.name}</div>
                        </td>
                        <td className="text-3 text-sm">{record.date}</td>
                        <td className="num">
                          {record.score} / {record.total}
                        </td>
                        <td>
                          <Badge tone={record.pending ? "warn" : "ok"}>
                            {record.pending ? "待阅" : "已完成"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="stack">
          {/* 成绩趋势 */}
          <Card title="成绩趋势" actions={<span className="text-sm text-3">最近 {trend.length} 次</span>}>
            {trend.length === 0 ? (
              <Empty title="暂无成绩记录" body="完成一次练习或考试后，这里会显示成绩变化曲线。" />
            ) : (
              <LineChart data={trend} title="趋势图" />
            )}
          </Card>

          {/* 错题分布 */}
          <Card
            title="错题分布"
            actions={
              <Button size="sm" onClick={() => navigate("/mistakes")}>
                去订正
              </Button>
            }
          >
            {mistakeDistribution.length === 0 ? (
              <Empty title="错题本是空的" body="做错的题目会自动收录到这里，方便反复订正。" />
            ) : (
              mistakeDistribution.map((entry) => (
                <div className="bar-row" key={entry.tagId}>
                  <span className="od-truncate">{entry.name}</span>
                  <span className="bar-track">
                    <span
                      className={`bar-fill${entry.tone === "warn" ? " is-warn" : ""}`}
                      style={{ width: `${Math.round((entry.count / Math.max(1, mistakeDistribution[0]!.count)) * 100)}%` }}
                    />
                  </span>
                  <span className="right num text-sm">{entry.count} 题</span>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>

      {/* 保持 exams / practices 参与依赖，避免内容变更后不刷新 */}
      <span hidden>{exams.length + practices.length}</span>
    </>
  );
}
