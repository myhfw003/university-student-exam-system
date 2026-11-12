import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * 无障碍名称。图标按钮没有可见文字，**必须**提供。
   */
  label: string;
  /** 图标内容（建议为内联 SVG，需自带 aria-hidden）。 */
  children: ReactNode;
  /** 尺寸：默认 34px（原型 .icon-btn）。 */
  size?: "sm" | "md";
}

const SIZE_CLASS = {
  sm: "icon-btn is-sm",
  md: "icon-btn",
} as const;

/**
 * 图标按钮。强制要求 `label`，最终渲染为 `aria-label`。
 */
export function IconButton({
  label,
  size = "md",
  className,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  const classes = [SIZE_CLASS[size], className].filter(Boolean).join(" ");
  return (
    <button {...rest} type={type} className={classes} aria-label={label} title={label}>
      {children}
    </button>
  );
}
