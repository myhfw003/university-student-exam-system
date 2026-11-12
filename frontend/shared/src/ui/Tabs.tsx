/* ==========================================================================
   知行测评 · 标签页
   --------------------------------------------------------------------------
   类名沿用原型 .tabs / .tab。选中态用 aria-selected 表达。
   键盘可达：左右方向键在标签间移动焦点。
   ========================================================================== */

import { useRef, type ReactNode } from "react";

/** 标签项。 */
export interface TabItem<T extends string = string> {
  /** 项值。 */
  value: T;
  /** 标签文案。 */
  label: ReactNode;
  /** 角标（可选）。 */
  badge?: ReactNode;
  /** 是否禁用。 */
  disabled?: boolean;
}

/** 标签页属性。 */
export interface TabsProps<T extends string = string> {
  /** 标签项。 */
  items: ReadonlyArray<TabItem<T>>;
  /** 当前选中值。 */
  value: T;
  /** 选中变化回调。 */
  onChange: (value: T) => void;
  /** 分组的无障碍名称。 */
  label?: string;
  /** 额外类名。 */
  className?: string;
  /**
   * 外观变体。
   * - "tabs"（缺省）：下划线式标签页。
   * - "seg"：分段控件外观（原型题库工作台用），语义仍是 tablist。
   */
  variant?: "tabs" | "seg";
}

/** 标签页。 */
export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  label = "切换",
  className,
  variant = "tabs",
}: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  const move = (delta: number) => {
    const enabled = items.filter((item) => !item.disabled);
    const currentIndex = enabled.findIndex((item) => item.value === value);
    const next = enabled[(currentIndex + delta + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    buttons?.[items.indexOf(next)]?.focus();
  };

  const classes = [variant === "seg" ? "seg" : "tabs", className].filter(Boolean).join(" ");

  return (
    <div className={classes} role="tablist" aria-label={label} ref={listRef}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            className={variant === "seg" ? undefined : "tab"}
            aria-selected={selected}
            aria-disabled={item.disabled || undefined}
            disabled={item.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(-1);
              }
            }}
          >
            {item.label}
            {item.badge != null ? <span className="nav-count">{item.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
