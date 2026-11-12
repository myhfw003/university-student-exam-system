import type { CSSProperties } from "react";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** 圆角。 */
  radius?: number | string;
  /** 形状：默认矩形；circle 用于头像等圆形占位。 */
  shape?: "rect" | "circle";
  className?: string;
}

/**
 * 骨架屏占位块。
 */
export function Skeleton({
  width = "100%",
  height = 16,
  radius,
  shape = "rect",
  className,
}: SkeletonProps) {
  const style: CSSProperties = {
    width,
    height,
    borderRadius: radius ?? (shape === "circle" ? "50%" : "var(--r-sm)"),
  };
  const classes = ["skeleton", className].filter(Boolean).join(" ");
  return <span aria-hidden="true" className={classes} style={style} />;
}
