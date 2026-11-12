/* ==========================================================================
   知行测评 · 答题区水印
   --------------------------------------------------------------------------
   对应 docs/design/06-frontend.md §6.3。

   用绝对定位的重复文本节点实现，`pointer-events: none` 不影响交互。
   文案：姓名 + 账号 + 时间戳。
   ========================================================================== */

import { useMemo } from "react";

/** 水印组件属性。 */
export interface WatermarkProps {
  /** 姓名。 */
  displayName: string;
  /** 账号。 */
  username: string;
  /** 重复的行数。 */
  rows?: number;
  /** 重复的列数。 */
  columns?: number;
  /** 附加时间戳文本。 */
  timestamp?: string;
  /** 样式类名。 */
  className?: string;
}

/**
 * 水印。以低透明度平铺在答题区背景上。
 */
export function Watermark({
  displayName,
  username,
  rows = 6,
  columns = 4,
  timestamp,
  className,
}: WatermarkProps) {
  const text = useMemo(
    () => [displayName, username, timestamp].filter(Boolean).join(" · "),
    [displayName, username, timestamp],
  );

  const cells = useMemo(() => {
    const out: Array<{ key: string; row: number; col: number }> = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < columns; c += 1) {
        out.push({ key: `${r}-${c}`, row: r, col: c });
      }
    }
    return out;
  }, [rows, columns]);

  return (
    <div
      className={className}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {cells.map((cell) => (
        <span
          key={cell.key}
          style={{
            position: "absolute",
            left: `${(cell.col * 100) / columns + 4}%`,
            top: `${(cell.row * 100) / rows + 3}%`,
            transform: "rotate(-18deg)",
            whiteSpace: "nowrap",
            fontSize: 12,
            letterSpacing: "0.08em",
            color: "var(--c-text-3)",
            opacity: 0.16,
            userSelect: "none",
          }}
        >
          {text}
        </span>
      ))}
    </div>
  );
}
