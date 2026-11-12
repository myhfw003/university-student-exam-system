/* ==========================================================================
   知行测评 · 规则清单
   --------------------------------------------------------------------------
   原型结构：ul.rule-list > li > span.rule-dot + 正文。
   dot 传序号（1/2/3）显示数字，传 "·" 显示圆点。
   ========================================================================== */

import type { ReactNode } from "react";

/** 规则清单属性。 */
export interface RuleListProps {
  items: readonly ReactNode[];
  /** 序号样式：默认数字。 */
  marker?: "number" | "dot";
  className?: string;
}

/** 规则清单。 */
export function RuleList({ items, marker = "number", className }: RuleListProps) {
  return (
    <ul className={`rule-list${className ? ` ${className}` : ""}`}>
      {items.map((item, index) => (
        <li key={index}>
          <span className="rule-dot" aria-hidden="true">
            {marker === "dot" ? "·" : index + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
