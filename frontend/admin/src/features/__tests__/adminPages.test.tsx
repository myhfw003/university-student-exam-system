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
import { useToastStore } from "@exam/shared";
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
import { QuestionEditor } from "../shared/QuestionEditor";

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
  // 提示条是全局 store，测试间清空，避免读到上一条用例的文案。
  useToastStore.setState({ toasts: [] });
});

/** 最近一条提示条文案（提示条渲染在应用外壳上，单元测试里直接读 store）。 */
function lastToast(): string | undefined {
  const toasts = useToastStore.getState().toasts;
  return toasts[toasts.length - 1]?.message;
}

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
    await user.click(within(dialog).getByRole("button", { name: "保存标签" }));

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

describe("管理端题库编辑器", () => {
  it("?edit= 深链直接打开对应题库的编辑对话框", () => {
    const banks = useCatalog.getState().banks;
    const target = banks[0]!;
    renderPage(<BanksPage />, `/banks?edit=${target.id}`);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/题库名称/)).toHaveValue(target.name);
  });

  it("题目清单按题型分组勾选并计入已选题数", async () => {
    const user = userEvent.setup();
    renderPage(<BanksPage />);
    await user.click(screen.getByRole("button", { name: /新建题库/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("题目清单")).toBeInTheDocument();
    expect(within(dialog).getByText("已选 0 题")).toBeInTheDocument();

    // 勾选一道题 → 已选计数与归属同步更新。
    const first = within(dialog).getAllByRole("checkbox")[0]!;
    await user.click(first);
    expect(within(dialog).getByText("已选 1 题")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/题库名称/), "测试题库");
    await user.click(within(dialog).getByRole("button", { name: "保存题库" }));

    const created = useCatalog.getState().banks.find((b) => b.name === "测试题库");
    expect(created?.questionIds).toHaveLength(1);
  });

  it("题库清单展示覆盖维度列", () => {
    renderPage(<BanksPage />);
    expect(screen.getByRole("columnheader", { name: "覆盖维度" })).toBeInTheDocument();
  });
});

describe("管理端题目编辑器", () => {
  it("切换题型重建下半区：无答案时拒绝保存", async () => {
    const user = userEvent.setup();
    renderPage(<QuestionEditor open question={null} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");

    await user.type(within(dialog).getByLabelText(/题目编号/), "q-test-01");
    await user.type(within(dialog).getByLabelText(/题干/), "测试题干");

    // 单选：未勾选正确答案 → 拒绝保存（原型「请至少勾选一个正确答案」）。
    await user.click(within(dialog).getByRole("button", { name: "保存题目" }));
    expect(lastToast()).toBe("请至少勾选一个正确答案");

    // 切到判断题：选项重建为「正确 / 错误」两项。
    await user.selectOptions(within(dialog).getByLabelText(/题型/), "judge");
    expect(within(dialog).getByDisplayValue("正确")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("错误")).toBeInTheDocument();
  });

  it("题号重复时拒绝保存", async () => {
    const user = userEvent.setup();
    const existing = useCatalog.getState().questions[0]!;
    renderPage(<QuestionEditor open question={null} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");

    await user.type(within(dialog).getByLabelText(/题目编号/), existing.id);
    await user.type(within(dialog).getByLabelText(/题干/), "重复题号");
    await user.click(within(dialog).getByRole("button", { name: "保存题目" }));

    expect(lastToast()).toBe(`题号 ${existing.id} 已存在，请更换`);
  });
});

describe("管理端组卷向导筛选", () => {
  it("题库与题型为多选下拉并给出说明", () => {
    renderPage(<PaperWizardPage />, "/papers/exam-net-mid?kind=exam&step=select", "/papers/:paperId");
    expect(screen.getByRole("button", { name: /题库筛选（可多选）/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /题型筛选（可多选）/ })).toBeInTheDocument();
    expect(
      screen.getByText("题库与题型均可多选；未选择时表示不限制，命中任一所选项即列出。"),
    ).toBeInTheDocument();
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

  it("按标签筛选：含子标签时父标签命中子标签的题目", async () => {
    const user = userEvent.setup();
    renderPage(<BankWorkbenchPage />, "/banks/__all__?tab=questions", "/banks/:bankId");

    // 「编程实现」挂在「应用迁移」下：选中父标签，含子标签时它也算命中。
    await user.click(screen.getByRole("button", { name: "应用迁移" }));

    // q-d-05 挂的是「编程实现」，按子标签命中。
    expect(screen.getByText(/给定带头结点的单链表 L/)).toBeInTheDocument();

    // 关掉「包含子标签」：只认标签本身，这道题不再出现。
    await user.click(screen.getByRole("checkbox", { name: "包含子标签" }));
    expect(screen.queryByText(/给定带头结点的单链表 L/)).not.toBeInTheDocument();
  });

  it("按标签筛选：全部命中要求同时命中每个选中的标签", async () => {
    const user = userEvent.setup();
    renderPage(<BankWorkbenchPage />, "/banks/__all__?tab=questions", "/banks/:bankId");

    // q-m-01 挂「高等数学」+「计算求解」，q-m-05 只挂「高等数学」。
    await user.click(screen.getByRole("button", { name: "高等数学" }));
    await user.click(screen.getByRole("button", { name: "计算求解" }));

    // 任一命中：两个标签命中任意一个都算数。
    expect(screen.getByText(/求极限 lim\(x→0\)/)).toBeInTheDocument();
    expect(screen.getByText(/下列级数中绝对收敛的有/)).toBeInTheDocument();

    // 切到「全部命中」：两个标签都要命中，只挂一个的不再出现。
    await user.click(screen.getByRole("button", { name: "全部命中" }));
    expect(screen.getByText(/求极限 lim\(x→0\)/)).toBeInTheDocument();
    expect(screen.queryByText(/下列级数中绝对收敛的有/)).not.toBeInTheDocument();
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

describe("管理端实体标签", () => {
  it("组卷列表的行操作可打开标签弹窗并保存", async () => {
    const user = userEvent.setup();
    renderPage(<PaperListPage />);
    const exam = useCatalog.getState().exams[0]!;

    await user.click(screen.getAllByRole("button", { name: "标签" })[0]!);
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "标签用于把试卷接入领域 / 知识点 / 能力等维度，答题端据此筛选与归档。",
      ),
    ).toBeInTheDocument();

    // 勾一个标签后保存，标签落到该试卷上。
    const chips = within(dialog).getAllByRole("button");
    const chip = chips.find((el) => el.getAttribute("aria-pressed") === "false");
    await user.click(chip!);
    await user.click(within(dialog).getByRole("button", { name: "保存标签" }));

    expect(lastToast()).toBe("标签已更新");
    const saved = useCatalog.getState().exams.find((e) => e.id === exam.id);
    expect(saved?.tags.length).toBeGreaterThan(0);
  });

  it("向导页头有标签按钮并可保存", async () => {
    const user = userEvent.setup();
    renderPage(<PaperWizardPage />, "/papers/exam-net-mid?kind=exam&step=basic", "/papers/:paperId");

    await user.click(screen.getByRole("button", { name: "标签" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/^试卷标签 · /)).toBeInTheDocument();

    const chip = within(dialog)
      .getAllByRole("button")
      .find((el) => el.getAttribute("aria-pressed") === "false");
    await user.click(chip!);
    await user.click(within(dialog).getByRole("button", { name: "保存标签" }));

    expect(lastToast()).toBe("标签已更新");
    expect(useCatalog.getState().exams.find((e) => e.id === "exam-net-mid")?.tags.length)
      .toBeGreaterThan(0);
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

  it("步骤级卷宗展示步骤评分卡（原型 admin.js:599-607）", async () => {
    const user = userEvent.setup();
    renderPage(<ReviewCenterPage />);

    // 队列里有按步骤阅卷的卷宗（q-d-05 的第 2 步）。
    const stepRows = screen.getAllByText(/步骤 s2/);
    await user.click(stepRows[0]!);

    expect(screen.getByRole("heading", { name: "步骤评分" })).toBeInTheDocument();
    expect(screen.getByText("第二步：写出可编译的 C 代码。")).toBeInTheDocument();
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
  it("不带场次时先让管理员挑一个场次", () => {
    // 侧栏「实时监考」指向 /monitoring，没有这一屏就会落到 404。
    renderPage(<ProctoringPage />, "/monitoring", "/monitoring/:sessionId?");
    expect(screen.getByRole("heading", { name: "实时监考" })).toBeInTheDocument();
    expect(screen.getByText("可监考场次")).toBeInTheDocument();
    // 种子数据里 sess-net-mid 是进行中的场次，可以进入监考。
    expect(screen.getByRole("button", { name: "进入监考" })).toBeInTheDocument();
    expect(screen.getByText("计算机网络期中考试 · 第 1 场")).toBeInTheDocument();
  });

  it("渲染考生状态表并可执行处置", async () => {
    const user = userEvent.setup();
    renderPage(<ProctoringPage />, "/monitoring/sess-net-mid", "/monitoring/:sessionId?");
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
    renderPage(<ProctoringPage />, "/monitoring/sess-net-mid", "/monitoring/:sessionId?");
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
    expect(useAdminOps.getState().auditLogs.some((l) => l.action === "user.assign-roles")).toBe(true);
  });
});

describe("管理端审计页", () => {
  it("渲染审计条目并支持动作筛选", async () => {
    renderPage(<AuditLogPage />);
    expect(screen.getByRole("heading", { name: "审计" })).toBeInTheDocument();

    const logs = useAdminOps.getState().auditLogs;
    expect(screen.getByText(logs[0]!.summary)).toBeInTheDocument();
  });

  it("按时间范围筛选：只留下范围内的行（FR-IAM-07 的四种筛选之一）", async () => {
    const user = userEvent.setup();
    renderPage(<AuditLogPage />);

    const logs = useAdminOps.getState().auditLogs;
    // 种子数据跨 11 月 4 日到 11 月 12 日。
    const before = logs.length;
    expect(before).toBeGreaterThan(1);

    // 选一天：只剩那天的那几行。
    await user.type(screen.getByLabelText("起始日期"), "2026-11-12");
    await user.type(screen.getByLabelText("结束日期"), "2026-11-12");

    const expected = logs.filter((log) => log.at.startsWith("2026-11-12")).length;
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(before);
    expect(screen.getByText(`${expected} / ${expected} 条`)).toBeInTheDocument();

    // 选一个没有数据的日期：列表空掉。
    await user.clear(screen.getByLabelText("起始日期"));
    await user.clear(screen.getByLabelText("结束日期"));
    await user.type(screen.getByLabelText("起始日期"), "2020-01-01");
    await user.type(screen.getByLabelText("结束日期"), "2020-01-02");
    expect(screen.getByText("没有符合条件的日志")).toBeInTheDocument();
  });
});
