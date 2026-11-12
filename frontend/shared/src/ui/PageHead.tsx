/* ==========================================================================
   知行测评 · 页面标题区
   --------------------------------------------------------------------------
   原型 .page-head：标题 + 副标题 + 右侧操作区。
   ========================================================================== */

import type { ReactNode } from "react";

/** 页面标题区属性。 */
export interface PageHeadProps {
  /** 主标题。 */
  title: ReactNode;
  /** 副标题。 */
  sub?: ReactNode;
  /** 右侧操作区。 */
  actions?: ReactNode;
  /** 额外类名。 */
  className?: string;
}

/** 页面标题区。 */
export function PageHead({ title, sub, actions, className }: PageHeadProps) {
  return (
    <div className={`page-head${className ? ` ${className}` : ""}`}>
      <div>
        <h1 className="page-title">{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
