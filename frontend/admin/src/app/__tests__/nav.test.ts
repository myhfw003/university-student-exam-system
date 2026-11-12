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

  it("测评组包含组卷 / 阅卷中心 / 成绩分析", () => {
    const assessment = ADMIN_NAV[1];
    expect(assessment?.items.map((item) => item.label)).toEqual(["组卷", "阅卷中心", "成绩分析"]);
  });

  it("系统组包含用户 / 审计", () => {
    const system = ADMIN_NAV[2];
    expect(system?.items.map((item) => item.label)).toEqual(["用户", "审计"]);
  });
});
