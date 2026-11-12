import type { ButtonHTMLAttributes, ReactNode } from "react";

/** 按钮变体，与原型 .btn-primary / .btn-danger / .btn-ghost 对应。 */
export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

/** 按钮尺寸，与原型 .btn-sm / .btn-lg 对应。 */
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 加载中：禁用交互并显示旋转指示器。 */
  loading?: boolean;
  /** 加载中时展示的文案；缺省时保留 children。 */
  loadingText?: ReactNode;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
  ghost: "btn-ghost",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "btn-sm",
  md: "",
  lg: "btn-lg",
};

/**
 * 按钮。类名沿用原型语义化类（.btn / .btn-primary / .btn-sm …）。
 */
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  loadingText,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = ["btn", VARIANT_CLASS[variant], SIZE_CLASS[size], loading ? "is-loading" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...rest}
      type={type}
      className={className ? `${classes} ${className}` : classes}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : null}
      {loading && loadingText !== undefined ? loadingText : children}
    </button>
  );
}
