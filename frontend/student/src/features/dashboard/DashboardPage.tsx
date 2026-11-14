/* ==========================================================================
   知行测评 · 学生端工作台
   --------------------------------------------------------------------------
   对应原型 student.dashboard：问候语、四个统计卡、进行中的考试、
   推荐练习、最近成绩、成绩趋势、错题分布。
   ========================================================================== */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Callout, Card, Empty, LineChart, PageHead, Stat } from "@exam/shared";
import { formatScore } from "@exam/shared";
import { getStudent, TAG_GROUP_LABEL, useCatalog } from "@exam/shared/mock/catalog";
import { PAPER_MODES, normalizeConfig, variantLabelOf } from "@exam/shared/engine/paper";
import type { ExamPaper } from "@exam/shared/domain/types";
import { Icon } from "@/app/Icon";
import { TagChips, knowledgeTag } from "@/features/shared/TagChips";
import { examSessionKey, useExamSessionStore } from "@/stores/examSessionStore";
import { useStudentStore } from "@/stores/studentStore";
import {
  greetingFor,
  useOngoingExam,
  useStudentMistakes,
  useStudentRecords,
  useVisiblePractices,
  weekdayOf,
} from "@/features/shared/studentData";

/** 有效卷型的标签 / 短说明 / 长说明（原型取 plumCfg(exam).mode）。 */
function modeInfo(exam: ExamPaper) {
  return PAPER_MODES[normalizeConfig(exam).mode];
}

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
  // 已有会话（开始过这场考试）时，入口显示「继续考试」（原型 student.js:443）。
  const examSessions = useExamSessionStore((state) => state.sessions);
  const ongoingStartedAt = ongoing
    ? examSessions[examSessionKey(ongoing.id, studentId)]?.startedAt
    : undefined;
  // 已交过分的练习 ID：用于区分「待完成」与「已完成」。
  const practiceResultKeys = useMemo(
    () => new Set(records.filter((r) => r.kind === "practice").map((r) => r.id)),
    [records],
  );

  const now = new Date();
  const greeting = greetingFor(now.getHours());

  /* ---------------------------------------------------------- 统计 */

  // 原型 student.js:366-369：统计的是**未完成**（还没有练习成绩）的练习。
  const pendingPractices = practices_.filter((p) => !practiceResultKeys.has(p.id)).length;
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

  // 原型 student.js:586：按「知识点」分组，没有知识点就回退到领域，
  // 都没有则归入「未归类」。
  const mistakeDistribution = useMemo(() => {
    const catalog = useCatalog.getState();
    const groups = new Map<string, { name: string; group: string; count: number }>();
    for (const mistake of mistakes) {
      const question = catalog.questions.find((q) => q.id === mistake.qid);
      if (!question) continue;
      const tag = knowledgeTag(question.tags, catalog.tags);
      const key = tag ? tag.id : "unknown";
      const entry = groups.get(key) ?? {
        name: tag ? tag.name : "未归类",
        group: tag ? (TAG_GROUP_LABEL[tag.group] ?? tag.group) : "领域",
        count: 0,
      };
      entry.count += 1;
      groups.set(key, entry);
    }
    const entries = [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
    const max = entries.length > 0 ? entries[0]![1].count : 0;
    return entries.map(([key, entry]) => ({
      key,
      name: entry.name,
      group: entry.group,
      count: entry.count,
      tone: entry.count === max ? ("default" as const) : ("warn" as const),
    }));
  }, [mistakes]);

  return (
    <>
      <PageHead
        title={`${greeting}，${student?.name ?? studentId}`}
        sub={`${className} · 编号 ${studentId} · 今天 ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 ${weekdayOf(now)}`}
        actions={
          <>
            <Button onClick={() => navigate("/exams")}>
              <Icon name="clipboard" />
              考试安排
            </Button>
            <Button variant="primary" onClick={() => navigate("/practice")}>
              <Icon name="book" />
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
                    <span className="variant-tag">{modeInfo(ongoing).label}</span>
                    <span className="text-sm text-3">
                      你的卷号 {variantLabelOf(normalizeConfig(ongoing), studentId)}
                    </span>
                  </div>
                  <div className="row-tight">
                    <TagChips tags={ongoing.tags} />
                  </div>
                </div>
                <div className="spacer" />
                <Button variant="primary" onClick={() => navigate(`/exams/${ongoing.id}`)}>
                  {/* 原型 student.js:443：已有会话显示「继续考试」。 */}
                  {ongoingStartedAt ? "继续考试" : "进入考试"}
                </Button>
              </div>
              {/* 原型 student.js:449：须知里带整句卷型说明。 */}
              <div style={{ marginTop: "var(--sp-4)" }}>
                <Callout title="考试须知" icon={<Icon name="info" />}>
                  {ongoing.note} 本卷采用{modeInfo(ongoing).label}（
                  {modeInfo(ongoing).short}）：{modeInfo(ongoing).desc}
                </Callout>
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
                      {/* 原型 student.js:461：一行副标题，末尾是上次得分或「尚未开始」。 */}
                      <div className="list-sub">
                        {practice.questionIds.length} 题 · 约 {practice.durationMin} 分钟 ·{" "}
                        {result
                          ? `上次得分 ${formatScore(result.score)}/${formatScore(result.total)}（${Math.round(
                              result.total > 0 ? (result.score / result.total) * 100 : 0,
                            )}%）`
                          : "尚未开始"}
                      </div>
                      <div className="row-tight" style={{ marginTop: "var(--sp-2)" }}>
                        <TagChips tags={practice.tags} />
                      </div>
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
                      <th scope="col">项目</th>
                      <th scope="col">日期</th>
                      <th className="right" scope="col">得分</th>
                      <th scope="col">状态</th>
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
          <Card
            title="成绩趋势"
            actions={<span className="text-sm text-3">最近 {records.length} 次</span>}
          >
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
                <div className="bar-row" key={entry.key}>
                  <span className="od-truncate">
                    {entry.name}
                    <span className="text-3 text-xs"> · {entry.group}</span>
                  </span>
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
