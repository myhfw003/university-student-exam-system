/* ==========================================================================
   题目来源口径的映射
   --------------------------------------------------------------------------
   服务端把 AI 生成的题存成 `generated`，前端口径叫 `ai`。
   两边各叫各的，界面上就会出现「来源是空白」的标签——
   而且**没有任何报错**：徽标查不到名字，显示成空。
   ========================================================================== */

import { describe, expect, it } from "vitest";
import { toQuestionSource } from "../questionSource";

describe("toQuestionSource · 服务端存储值 → 前端口径", () => {
  it("generated 映射成 ai", () => {
    expect(toQuestionSource("generated")).toBe("ai");
  });

  it("manual 与 import 原样透出", () => {
    expect(toQuestionSource("manual")).toBe("manual");
    expect(toQuestionSource("import")).toBe("import");
  });

  it("mock 模式的 ai 原样透出", () => {
    expect(toQuestionSource("ai")).toBe("ai");
  });

  it("缺值与认不出来的值都按手工录入算", () => {
    expect(toQuestionSource(undefined)).toBe("manual");
    expect(toQuestionSource(null)).toBe("manual");
    expect(toQuestionSource("说不清的来源")).toBe("manual");
  });
});
