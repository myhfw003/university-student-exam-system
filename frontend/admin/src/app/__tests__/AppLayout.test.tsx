/* ==========================================================================
   管理端应用外壳 · 侧栏
   --------------------------------------------------------------------------
   断言的是**用户能点什么**：侧栏列出的每一条都要能点到对应的路由。
   「考试场次」与「实时监考」是 React 独有的模块，接进侧栏后必须真的可达，
   不能只挂一个名字。
   ========================================================================== */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "../AppLayout";

/** 渲染带侧栏的应用外壳。 */
function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<div>视图内容</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("管理端侧栏", () => {
  it("列出原型那 8 个入口", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "主导航" });

    // 原型 admin-config.js 的侧栏：内容 / 测评 / 系统三组八条。
    expect(within(nav).getByRole("link", { name: /概览/ })).toHaveAttribute("href", "/overview");
    expect(within(nav).getByRole("link", { name: /标签/ })).toHaveAttribute("href", "/tags");
    expect(within(nav).getByRole("link", { name: /题库/ })).toHaveAttribute("href", "/banks");
    expect(within(nav).getByRole("link", { name: /组卷/ })).toHaveAttribute("href", "/papers");
    expect(within(nav).getByRole("link", { name: /阅卷中心/ })).toHaveAttribute(
      "href",
      "/review",
    );
    expect(within(nav).getByRole("link", { name: /成绩分析/ })).toHaveAttribute(
      "href",
      "/analytics",
    );
    expect(within(nav).getByRole("link", { name: /用户/ })).toHaveAttribute("href", "/users");
    expect(within(nav).getByRole("link", { name: /审计/ })).toHaveAttribute(
      "href",
      "/audit-logs",
    );
  });

  it("考试场次与实时监考也能从侧栏点到", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "主导航" });

    expect(within(nav).getByRole("link", { name: /考试场次/ })).toHaveAttribute(
      "href",
      "/exam-sessions",
    );
    expect(within(nav).getByRole("link", { name: /实时监考/ })).toHaveAttribute(
      "href",
      "/monitoring",
    );
  });

  it("侧栏共 10 个入口，分内容 / 测评 / 系统三组", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "主导航" });

    expect(within(nav).getAllByRole("link")).toHaveLength(10);
    expect(within(nav).getAllByText(/^(内容|测评|系统)$/)).toHaveLength(3);
  });
});
