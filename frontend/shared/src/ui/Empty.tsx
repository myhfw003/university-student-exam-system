import type { ReactNode } from "react";

export interface EmptyProps {
  title: ReactNode;
  body?: ReactNode;
  /** 操作区，通常放一个 Button。 */
  action?: ReactNode;
  className?: string;
}

/**
 * 空状态。类名沿用原型 .empty / .empty-title / .empty-body。
 */
export function Empty({ title, body, action, className }: EmptyProps) {
  const classes = ["empty", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      {/* 原型 .empty 是 grid，子元素一律用 span。 */}
      <span className="empty-title">{title}</span>
      {body ? <span className="empty-body">{body}</span> : null}
      {action ? <span>{action}</span> : null}
    </div>
  );
}
