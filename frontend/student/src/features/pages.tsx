/* ==========================================================================
   知行测评 · 学生端占位页面
   每个路由一个占位页面；真实业务在后续任务中按 docs/design/06-frontend.md 补齐。
   ========================================================================== */

import { useParams } from "react-router-dom";
import { Badge, Callout, Empty, Stat } from "@exam/shared";

interface PageProps {
  title: string;
  sub?: string;
  children?: React.ReactNode;
}

function Page({ title, sub, children }: PageProps) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          {sub ? <p className="page-sub">{sub}</p> : null}
        </div>
      </div>
      {children}
    </>
  );
}

export function DashboardPage() {
  return (
    <Page title="工作台" sub="今天的学习安排与最近的练习、考试动态一览。">
      <div className="stat-row">
        <Stat label="待完成练习" value={6} unit="项" hint="本周累计完成 12 项" />
        <Stat label="待参加考试" value={2} unit="场" hint="最近一场 11 月 15 日 09:00" />
        <Stat label="错题待复习" value={12} unit="题" hint="其中 3 题为高频错题" />
        <Stat label="平均得分" value={86.5} unit="分" hint="较上月提升 4.2 分" />
      </div>
      <div className="grid-2" style={{ marginTop: "var(--sp-5)" }}>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">最近考试</h2>
          </div>
          <div className="card-body">
            <Empty title="暂无考试记录" body="完成一场练习或考试后，这里会显示最近的成绩趋势。" />
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">待办事项</h2>
          </div>
          <div className="card-body">
            <Callout tone="info" title="尚未接入后端">
              本页为骨架占位，接入接口后展示真实的待办列表。
            </Callout>
          </div>
        </section>
      </div>
    </Page>
  );
}

export function PracticeListPage() {
  return (
    <Page title="练习中心" sub="按知识点、难度或题型筛选练习任务，随时开始、随时续做。">
      <Callout tone="info" title="尚未接入后端">
        练习列表与作答页将在接入 /assignments 接口后实现。
      </Callout>
    </Page>
  );
}

export function PracticeSessionPage() {
  const { assignmentId } = useParams();
  return (
    <Page title="练习作答" sub={`练习编号 ${assignmentId ?? "—"}`}>
      <Callout tone="info" title="尚未接入后端">
        作答页将按「L1 内存缓冲 → L2 IndexedDB → L3 上行队列 → L4 服务端持久化」四层保障实现。
      </Callout>
    </Page>
  );
}

export function ExamListPage() {
  return (
    <Page title="考试安排" sub="即将开始的考试、已结束的考试与成绩状态。">
      <Callout tone="info" title="尚未接入后端">
        考试场次列表将在接入 /exam-sessions 接口后实现。
      </Callout>
    </Page>
  );
}

export function ExamSessionPage() {
  const { sessionId } = useParams();
  return (
    <Page title="在线答题" sub={`场次编号 ${sessionId ?? "—"}`}>
      <Callout tone="warn" title="尚未接入后端">
        答题页将实现服务端权威倒计时、切屏检测与水印，当前为骨架占位。
      </Callout>
    </Page>
  );
}

export function ExamReportPage() {
  const { sessionId } = useParams();
  return (
    <Page title="成绩报告" sub={`场次编号 ${sessionId ?? "—"}`}>
      <Callout tone="info" title="尚未接入后端">
        报告页将展示总分、分题得分、知识点掌握度与解析。
      </Callout>
    </Page>
  );
}

export function ReportListPage() {
  return (
    <Page title="成绩报告" sub="历次练习与考试的得分记录。">
      <Callout tone="info" title="尚未接入后端">
        成绩列表将在接入 /reports 接口后实现。
      </Callout>
    </Page>
  );
}

export function MistakesPage() {
  return (
    <Page title="错题本" sub="按知识点归集的错题，支持重做与标记已掌握。">
      <div className="row">
        <Badge tone="warn">待复习 12</Badge>
        <Badge tone="ok">已掌握 48</Badge>
      </div>
    </Page>
  );
}

export function ProfilePage() {
  return (
    <Page title="个人中心" sub="账号信息、界面偏好与本地数据管理。">
      <Callout tone="info" title="尚未接入后端">
        个人资料与偏好设置将在接入 /auth/me 接口后实现。
      </Callout>
    </Page>
  );
}
