/* ==========================================================================
   知行测评 · 管理端占位页面
   每个路由一个占位页面；真实业务在后续任务中按 docs/design/06-frontend.md 补齐。
   ========================================================================== */

import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Badge, Callout, Stat } from "@exam/shared";

interface PageProps {
  title: string;
  sub?: string;
  children?: ReactNode;
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

export function OverviewPage() {
  return (
    <Page title="概览" sub="内容资产、测评运行与待办事项的全局视图。">
      <div className="stat-row">
        <Stat label="题库" value={12} unit="个" hint="题目 3846 道" />
        <Stat label="试卷" value={38} unit="份" hint="已发布 26 份" />
        <Stat label="待阅卷" value={7} unit="份" hint="简答与综合操作题" />
        <Stat label="考试场次" value={5} unit="场" hint="本周进行中 2 场" />
      </div>
      <div style={{ marginTop: "var(--sp-5)" }}>
        <Callout tone="info" title="尚未接入后端">
          概览页将在接入题库、试卷与考试场次统计接口后展示真实数据。
        </Callout>
      </div>
    </Page>
  );
}

export function TagsPage() {
  return (
    <Page title="标签" sub="五维标签词表：领域、知识点、能力、难度、组织。">
      <div className="row">
        <Badge tone="primary">领域</Badge>
        <Badge tone="info">知识点</Badge>
        <Badge tone="ok">能力</Badge>
        <Badge tone="warn">难度</Badge>
        <Badge tone="neutral">组织</Badge>
      </div>
      <div style={{ marginTop: "var(--sp-5)" }}>
        <Callout tone="info" title="尚未接入后端">
          标签树、标签编辑器与引用统计将在接入 /tags 接口后实现。
        </Callout>
      </div>
    </Page>
  );
}

export function BanksPage() {
  return (
    <Page title="题库" sub="按学科与用途组织的题目资产，支持导入、批量编辑与 AI 生成。">
      <Callout tone="info" title="尚未接入后端">
        题库列表与内容工作台将在接入 /banks 接口后实现。
      </Callout>
    </Page>
  );
}

export function BankWorkbenchPage() {
  const { bankId } = useParams();
  return (
    <Page title="题库工作台" sub={`题库编号 ${bankId ?? "—"}`}>
      <Callout tone="info" title="尚未接入后端">
        题库工作台将包含题目列表、导入面板、生成面板与标签编辑。
      </Callout>
    </Page>
  );
}

export function PaperListPage() {
  return (
    <Page title="组卷" sub="通过规则抽题或手工勾选组卷，支持梅花卷变式。">
      <Callout tone="info" title="尚未接入后端">
        试卷列表与组卷向导将在接入 /papers 接口后实现。
      </Callout>
    </Page>
  );
}

export function PaperWizardPage() {
  const { paperId } = useParams();
  return (
    <Page title="试卷向导" sub={`试卷编号 ${paperId ?? "—"}`}>
      <Callout tone="info" title="尚未接入后端">
        组卷向导包含蓝图配置、选题配分与发布前校验清单。
      </Callout>
    </Page>
  );
}

export function ExamSessionListPage() {
  return (
    <Page title="考试场次" sub="场次排期、名单管理与开考状态。">
      <Callout tone="info" title="尚未接入后端">
        场次列表将在接入 /exam-sessions 接口后实现。
      </Callout>
    </Page>
  );
}

export function ExamSessionDetailPage() {
  const { id } = useParams();
  return (
    <Page title="场次详情" sub={`场次编号 ${id ?? "—"}`}>
      <Callout tone="info" title="尚未接入后端">
        场次详情将包含考生名单、开考控制与成绩发布。
      </Callout>
    </Page>
  );
}

export function ProctoringPage() {
  const { sessionId } = useParams();
  return (
    <Page title="实时监考" sub={`场次编号 ${sessionId ?? "—"}`}>
      <Callout tone="warn" title="尚未接入后端">
        监考大屏将通过 SignalR 接收心跳聚合，1000 考生时使用虚拟滚动渲染表格。
      </Callout>
    </Page>
  );
}

export function ReviewCenterPage() {
  return (
    <Page title="阅卷中心" sub="简答与综合操作题的人工评阅、评分标定与复核。">
      <Callout tone="info" title="尚未接入后端">
        阅卷队列与评分表单将在接入 /admin/review 接口后实现。
      </Callout>
    </Page>
  );
}

export function AnalyticsPage() {
  return (
    <Page title="成绩分析" sub="得分分布、知识点掌握度与班级横向对比。">
      <Callout tone="info" title="尚未接入后端">
        分析页将在接入 /admin/analytics 接口后展示自研 SVG 图表。
      </Callout>
    </Page>
  );
}

export function UsersPage() {
  return (
    <Page title="用户" sub="账号、角色与权限点分配，支持批量导入。">
      <Callout tone="info" title="尚未接入后端">
        用户管理将在接入 /admin/users 接口后实现。
      </Callout>
    </Page>
  );
}

export function AuditLogPage() {
  return (
    <Page title="审计日志" sub="关键操作的留痕与检索。">
      <Callout tone="info" title="尚未接入后端">
        审计日志将在接入 /admin/audit-logs 接口后实现。
      </Callout>
    </Page>
  );
}
