import type { ReactNode } from "react";

/**
 * 提示条色调。
 *
 * 原型 .callout 默认是**主色**底（primary-soft），is-info 才是信息蓝，
 * is-ok / is-warn / is-danger 分别是成功 / 警告 / 危险。
 * 因此这里的默认色调是 `primary`，而非 `info`。
 */
export type CalloutTone = "primary" | "ok" | "warn" | "danger" | "info";

export interface CalloutProps {
  /** 色调；缺省为原型的默认主色底。 */
  tone?: CalloutTone;
  /** 标题，可选。 */
  title?: ReactNode;
  /** 标题前置图标（原型在标题前放一枚图标）。 */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * 提示条。使用 `role="status"` 让辅助技术播报内容变化。
 */
export function Callout({ tone = "primary", title, icon, children, className }: CalloutProps) {
  const classes = ["callout", tone === "primary" ? "" : `is-${tone}`, className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} role="status">
      {title ? (
        <span className="callout-title">
          {icon}
          {title}
        </span>
      ) : null}
      <span>{children}</span>
    </div>
  );
}
