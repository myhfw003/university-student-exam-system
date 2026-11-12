import type { ReactNode } from "react";

/** 提示条色调，与原型 .callout.is-ok / .is-warn / .is-danger / .is-info 对应。 */
export type CalloutTone = "ok" | "warn" | "danger" | "info";

export interface CalloutProps {
  tone?: CalloutTone;
  /** 标题，可选。 */
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * 提示条。使用 `role="status"` 让辅助技术播报内容变化。
 */
export function Callout({ tone = "info", title, children, className }: CalloutProps) {
  const classes = ["callout", `is-${tone}`, className].filter(Boolean).join(" ");
  return (
    <div className={classes} role="status">
      {title ? <div className="callout-title">{title}</div> : null}
      <div>{children}</div>
    </div>
  );
}
