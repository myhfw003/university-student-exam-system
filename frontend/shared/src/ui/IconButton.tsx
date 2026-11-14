import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * 无障碍名称。图标按钮没有可见文字，**必须**提供。
   */
  label: string;
  /** 图标内容（建议为内联 SVG，需自带 aria-hidden）。 */
  children: ReactNode;
}

/**
 * 图标按钮。强制要求 `label`，最终渲染为 `aria-label`。
 */
export function IconButton({
  label,
  className,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  // 原型只有一种图标按钮尺寸（.icon-btn，34px），没有 is-sm 档。
  const classes = ["icon-btn", className].filter(Boolean).join(" ");
  return (
    <button {...rest} type={type} className={classes} aria-label={label} title={label}>
      {children}
    </button>
  );
}
