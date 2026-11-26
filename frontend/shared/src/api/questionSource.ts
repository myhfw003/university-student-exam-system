/* ==========================================================================
   知行测评 · 题目来源口径
   --------------------------------------------------------------------------
   服务端把 AI 生成的题存成 `generated`，前端口径叫 `ai`。
   两边各叫各的，界面上就会出现「来源是空白」的标签——
   映射集中在这里，映射函数只在这一层做。
   ========================================================================== */

import type { Question } from "../domain/types";

/** 服务端存储值 → 前端口径。 */
export function toQuestionSource(value: unknown): Question["source"] {
  const raw = value === null || value === undefined ? "manual" : String(value);

  switch (raw) {
    case "generated":
      return "ai";
    case "import":
      return "import";
    case "ai":
      return "ai";
    case "manual":
      return "manual";
    default:
      return "manual";
  }
}
