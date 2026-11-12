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
      <div className="empty-title">{title}</div>
      {body ? <div className="empty-body">{body}</div> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}
