import type { ReactNode } from "react";

export interface CardProps {
  /** 卡片头部。 */
  title?: ReactNode;
  /** 头部右侧的操作区。 */
  actions?: ReactNode;
  /** 主体内容。 */
  children?: ReactNode;
  /** 底部操作区。 */
  footer?: ReactNode;
  /** 主体去掉内边距。 */
  flush?: boolean;
  className?: string;
}

/**
 * 卡片。类名沿用原型 .card / .card-head / .card-title / .card-body / .card-foot。
 */
export function Card({ title, actions, children, footer, flush = false, className }: CardProps) {
  const classes = ["card", className].filter(Boolean).join(" ");
  return (
    <section className={classes}>
      {title !== undefined || actions !== undefined ? (
        <div className="card-head">
          <h2 className="card-title">{title}</h2>
          {actions !== undefined ? <div className="row-tight">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? "card-body is-flush" : "card-body"}>{children}</div>
      {footer !== undefined ? <div className="card-foot">{footer}</div> : null}
    </section>
  );
}
