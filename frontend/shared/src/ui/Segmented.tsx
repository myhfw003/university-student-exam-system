import type { ReactNode } from "react";

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string = string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** 分组的无障碍名称。 */
  label?: string;
  className?: string;
}

/**
 * 分段控件。外层 `role="group"`，每个选项用 `aria-pressed` 表示选中态。
 */
export function Segmented<T extends string = string>({
  options,
  value,
  onChange,
  label = "切换",
  className,
}: SegmentedProps<T>) {
  const classes = ["seg", className].filter(Boolean).join(" ");
  return (
    <div className={classes} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={option.disabled === true}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
