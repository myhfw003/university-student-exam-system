import { describe, expect, it } from "vitest";
import { ADMIN_NAV } from "../nav";

describe("ADMIN_NAV", () => {
  it("分为内容 / 测评 / 系统三组", () => {
    expect(ADMIN_NAV.map((group) => group.group)).toEqual(["内容", "测评", "系统"]);
  });

  it("内容组包含概览 / 标签 / 题库", () => {
    const content = ADMIN_NAV[0];
    expect(content?.items.map((item) => item.label)).toEqual(["概览", "标签", "题库"]);
  });

  it("测评组包含组卷 / 练习开放单 / 阅卷中心 / 成绩分析 / 考试场次 / 实时监考", () => {
    const assessment = ADMIN_NAV[1];
    expect(assessment?.items.map((item) => item.label)).toEqual([
      "组卷",
      "练习开放单",
      "阅卷中心",
      "成绩分析",
      "考试场次",
      "实时监考",
    ]);
  });

  it("React 独有的三条路由也进了侧栏", () => {
    // 练习开放单、考试场次与实时监考是 React 独有的模块，原型侧栏没有。
    // 不进侧栏的话这几块功能在界面上没有任何入口，只能手输 URL。
    const paths = ADMIN_NAV.flatMap((group) => group.items.map((item) => item.path));
    expect(paths).toContain("/practices");
    expect(paths).toContain("/exam-sessions");
    expect(paths).toContain("/monitoring");
  });

  it("系统组包含用户 / 审计", () => {
    const system = ADMIN_NAV[2];
    expect(system?.items.map((item) => item.label)).toEqual(["用户", "审计"]);
  });
});
