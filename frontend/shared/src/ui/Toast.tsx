import type { ReactNode } from "react";

/** 提示条类型。error 用 `role="alert"`，其余用 `role="status"`。 */
export type ToastTone = "info" | "ok" | "error";

export interface ToastProps {
  tone?: ToastTone;
  children: ReactNode;
  className?: string;
}

/**
 * 单条提示。错误使用 `role="alert"` 立即播报，其余使用 `role="status"` 温和播报。
 */
export function Toast({ tone = "info", children, className }: ToastProps) {
  const classes = ["toast", tone !== "info" ? `is-${tone}` : null, className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export interface ToastHostProps {
  children?: ReactNode;
  className?: string;
}

/**
 * 提示条容器。
 */
export function ToastHost({ children, className }: ToastHostProps) {
  const classes = ["toast-host", className].filter(Boolean).join(" ");
  return (
    <div className={classes} aria-live="polite" aria-atomic="false">
      {children}
    </div>
  );
}
