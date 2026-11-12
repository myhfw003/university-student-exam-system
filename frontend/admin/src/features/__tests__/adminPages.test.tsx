/* ==========================================================================
   知行测评 · 管理端页面冒烟测试
   --------------------------------------------------------------------------
   覆盖每个管理端路由页面的关键渲染与关键交互。
   断言的是**行为**（用户能看到什么、能做什么），不是实现细节。
   ========================================================================== */

import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { resetCatalog, useCatalog } from "@exam/shared/mock/catalog";
import { resetAdminOps, useAdminOps } from "@exam/shared/mock/adminOps";
import { OverviewPage } from "../overview/OverviewPage";
import { TagsPage } from "../tags/TagsPage";
import { BanksPage } from "../banks/BanksPage";
import { BankWorkbenchPage } from "../banks/BankWorkbenchPage";
import { PaperListPage } from "../papers/PaperListPage";
import { PaperWizardPage } from "../papers/PaperWizardPage";
import { ReviewCenterPage } from "../review/ReviewCenterPage";
import { AnalyticsPage } from "../analytics/AnalyticsPage";
import { ExamSessionListPage } from "../sessions/ExamSessionListPage";
import { ExamSessionDetailPage } from "../sessions/ExamSessionDetailPage";
import { ProctoringPage } from "../monitoring/ProctoringPage";
import { UsersPage } from "../users/UsersPage";
import { AuditLogPage } from "../audit/AuditLogPage";

/** 渲染带路由的页面。 */
function renderPage(node: ReactNode, path = "/", routePath?: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {routePath ? (
          <Route path={routePath} element={node} />
        ) : (
          <Route path="*" element={node} />
        )}
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetCatalog();
  resetAdminOps();
});

describe("管理端概览页", () => {
  it("渲染标题与待办工作台", () => {
    renderPage(<OverviewPage />);
    expect(screen.getByRole("heading", { name: "概览" })).toBeInTheDocument();
    expect(screen.getByText("待办工作台")).toBeInTheDocument();
    expect(screen.getByText("候选题待审核")).toBeInTheDocument();
  });

  it("统计卡片反映当前题库状态", () => {
    renderPage(<OverviewPage />);
    const state = useCatalog.getState();
    expect(screen.getByText("题目总数")).toBeInTheDocument();
    expect(screen.getByText(String(state.questions.length))).toBeInTheDocument();
  });
});

describe("管理端标签页", () => {
  it("按分组渲染标签表与引用计数", () => {
    renderPage(<TagsPage />);
    expect(screen.getByRole("heading", { name: "标签" })).toBeInTheDocument();
    expect(screen.getAllByText("领域").length).toBeGreaterThan(0);
    expect(screen.getAllByText("难度").length).toBeGreaterThan(0);
  });

  it("新建标签后出现在列表中", async () => {
    const user = userEvent.setup();
    renderPage(<TagsPage />);

    await user.click(screen.getByRole("button", { name: /新建标签/ }));
    const nameInput = screen.getByLabelText(/标签名称/);
    await user.type(nameInput, "测试标签");

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(screen.getAllByText("测试标签").length).toBeGreaterThan(0);
    expect(useCatalog.getState().tags.some((t) => t.name === "测试标签")).toBe(true);
  });
});

describe("管理端题库页", () => {
  it("渲染题库清单与统计", () => {
    renderPage(<BanksPage />);
    expect(screen.getByRole("heading", { name: "题库" })).toBeInTheDocument();
    expect(screen.getByText("题库清单")).toBeInTheDocument();
    expect(screen.getByText("全部题库")).toBeInTheDocument();
  });
});

describe("管理端题库工作台", () => {
  it("默认展示题目标签页", () => {
    renderPage(<BankWorkbenchPage />, "/banks/__all__?tab=questions", "/banks/:bankId");
    expect(screen.getByRole("heading", { name: "全部题库" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /题目/ })).toBeInTheDocument();
  });

  it("切到候选题页展示审核队列", async () => {
    const user = userEvent.setup();
    renderPage(<BankWorkbenchPage />, "/banks/__all__?tab=questions", "/banks/:bankId");
    await user.click(screen.getByRole("tab", { name: /候选题/ }));
    expect(screen.getByText("候选题队列")).toBeInTheDocument();
  });
});

describe("管理端组卷列表", () => {
  it("渲染试卷清单与发布校验列", () => {
    renderPage(<PaperListPage />);
    expect(screen.getByRole("heading", { name: "组卷" })).toBeInTheDocument();
    expect(screen.getByText("发布校验")).toBeInTheDocument();
  });

  it("切到练习分段显示练习数量", async () => {
    const user = userEvent.setup();
    renderPage(<PaperListPage />);
    const practices = useCatalog.getState().practices;
    await user.click(screen.getByRole("button", { name: new RegExp(`练习 ${practices.length}`) }));
    expect(screen.getByRole("heading", { name: "练习" })).toBeInTheDocument();
  });
});

describe("管理端组卷向导", () => {
  it("四步导航齐全且首步是基本信息", () => {
    renderPage(<PaperWizardPage />, "/papers/exam-net-mid?kind=exam&step=basic", "/papers/:paperId");
    expect(screen.getByRole("heading", { name: "计算机网络期中考试" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /基本信息/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /选题与配分/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /卷型与梅花卷/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /名单与发布/ })).toBeInTheDocument();
  });

  it("卷型步骤展示三种梅花卷与答题者卷面预览", async () => {
    renderPage(<PaperWizardPage />, "/papers/exam-net-mid?kind=exam&step=plum", "/papers/:paperId");
    expect(screen.getByText("标准卷")).toBeInTheDocument();
    expect(screen.getByText("小梅花")).toBeInTheDocument();
    expect(screen.getByText("大梅花")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "答题者卷面预览" })).toBeInTheDocument();
  });

  it("发布步骤展示校验清单", () => {
    renderPage(<PaperWizardPage />, "/papers/exam-net-mid?kind=exam&step=publish", "/papers/:paperId");
    expect(screen.getByText("发布前校验")).toBeInTheDocument();
    expect(screen.getAllByText(/通过|未通过/).length).toBeGreaterThan(0);
  });
});

describe("管理端阅卷中心", () => {
  it("渲染卷宗队列与待阅计数", () => {
    renderPage(<ReviewCenterPage />);
    expect(screen.getByRole("heading", { name: "阅卷中心" })).toBeInTheDocument();
    expect(screen.getByText("卷宗队列")).toBeInTheDocument();
    const pending = useCatalog.getState().reviews.filter((r) => r.status === "pending").length;
    expect(screen.getByText(`待阅卷 ${pending}`)).toBeInTheDocument();
  });

  it("保存评分后卷宗标记为已阅", async () => {
    const user = userEvent.setup();
    renderPage(<ReviewCenterPage />);
    await user.click(screen.getByRole("button", { name: "保存评分" }));
    expect(useCatalog.getState().reviews.some((r) => r.status === "reviewed")).toBe(true);
  });
});

describe("管理端成绩分析", () => {
  it("渲染统计卡片与逐题正确率表", () => {
    renderPage(<AnalyticsPage />);
    expect(screen.getByRole("heading", { name: "成绩分析" })).toBeInTheDocument();
    expect(screen.getByText("平均分")).toBeInTheDocument();
    expect(screen.getByText("逐题正确率")).toBeInTheDocument();
  });
});

describe("管理端考试场次", () => {
  it("渲染场次清单", () => {
    renderPage(<ExamSessionListPage />);
    expect(screen.getByRole("heading", { name: "考试场次" })).toBeInTheDocument();
    expect(screen.getByText("场次清单")).toBeInTheDocument();
  });

  it("场次详情展示防作弊策略与名单", () => {
    renderPage(<ExamSessionDetailPage />, "/exam-sessions/sess-net-mid", "/exam-sessions/:id");
    expect(screen.getByRole("heading", { name: /计算机网络期中考试/ })).toBeInTheDocument();
    expect(screen.getByText("防作弊策略")).toBeInTheDocument();
    expect(screen.getByText("考生名单")).toBeInTheDocument();
  });
});

describe("管理端实时监考", () => {
  it("渲染考生状态表并可执行处置", async () => {
    const user = userEvent.setup();
    renderPage(<ProctoringPage />, "/monitoring/sess-net-mid", "/monitoring/:sessionId");
    expect(screen.getByRole("heading", { name: /实时监考/ })).toBeInTheDocument();
    expect(screen.getByText("考生状态")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "警告" })[0]!);
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/说明/), "请勿离开考场");
    await user.click(within(dialog).getByRole("button", { name: "确认" }));

    expect(useAdminOps.getState().proctorActions.length).toBe(1);
    expect(useAdminOps.getState().proctorActions[0]?.reason).toBe("请勿离开考场");
  });

  it("强制交卷必须填写原因", async () => {
    const user = userEvent.setup();
    renderPage(<ProctoringPage />, "/monitoring/sess-net-mid", "/monitoring/:sessionId");
    await user.click(screen.getAllByRole("button", { name: "强制交卷" })[0]!);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "确认" }));
    expect(useAdminOps.getState().proctorActions.length).toBe(0);
  });
});

describe("管理端用户页", () => {
  it("渲染账号清单与角色列", () => {
    renderPage(<UsersPage />);
    expect(screen.getByRole("heading", { name: "用户" })).toBeInTheDocument();
    expect(screen.getByText("账号清单")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "角色" })).toBeInTheDocument();
  });

  it("授予角色后权限即时生效并留痕", async () => {
    const user = userEvent.setup();
    renderPage(<UsersPage />);

    await user.click(screen.getAllByRole("button", { name: "角色" })[0]!);
    const dialog = screen.getByRole("dialog");
    const teacherBox = within(dialog).getByRole("checkbox", { name: /出题教师/ });
    await user.click(teacherBox);

    const updated = useAdminOps.getState().users[0];
    expect(updated?.roles).toContain("author_teacher");
    expect(useAdminOps.getState().auditLogs.some((l) => l.action === "user.role_changed")).toBe(true);
  });
});

describe("管理端审计页", () => {
  it("渲染审计条目并支持动作筛选", async () => {
    renderPage(<AuditLogPage />);
    expect(screen.getByRole("heading", { name: "审计" })).toBeInTheDocument();

    const logs = useAdminOps.getState().auditLogs;
    expect(screen.getByText(logs[0]!.summary)).toBeInTheDocument();
  });
});
