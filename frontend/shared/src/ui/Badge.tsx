import type { ReactNode } from "react";

/** 徽标色调，与原型 .badge-primary / .badge-info / .badge-neutral / .badge-warn / .badge-ok / .badge-danger 对应。 */
export type BadgeTone = "primary" | "info" | "neutral" | "warn" | "ok" | "danger";

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  /** 可点击徽标渲染为 button。 */
  onClick?: () => void;
}

export function Badge({ tone = "neutral", children, className, onClick }: BadgeProps) {
  const classes = ["badge", `badge-${tone}`, className].filter(Boolean).join(" ");
  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick}>
        {children}
      </button>
    );
  }
  return <span className={classes}>{children}</span>;
}
