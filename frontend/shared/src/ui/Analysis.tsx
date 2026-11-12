/* ==========================================================================
   知行测评 · 解析块
   --------------------------------------------------------------------------
   原型结构：.analysis（左侧 2px 主色竖条 + 浅底）。
   ========================================================================== */

import type { ReactNode } from "react";

/** 解析块属性。 */
export interface AnalysisProps {
  children: ReactNode;
  className?: string;
}

/** 解析块。 */
export function Analysis({ children, className }: AnalysisProps) {
  return <div className={`analysis${className ? ` ${className}` : ""}`}>{children}</div>;
}
