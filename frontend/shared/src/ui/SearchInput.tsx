import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";

export interface SearchInputProps {
  /** 当前值（受控）。 */
  value?: string;
  /** 默认值（非受控）。 */
  defaultValue?: string;
  /** 防抖后触发。 */
  onSearch: (value: string) => void;
  /** 输入即时触发（不防抖）。 */
  onChange?: (value: string) => void;
  placeholder?: string;
  /** 输入框的无障碍名称。 */
  label?: string;
  /** 防抖时长，默认 180ms。 */
  delay?: number;
  className?: string;
  /** 自动聚焦。 */
  autoFocus?: boolean;
}

/**
 * 搜索输入框。
 *
 * - 输入防抖 180ms 后才回调 onSearch；
 * - 防抖回调触发时把焦点收回输入框并把光标移到末尾，
 *   保证用户连续输入时不会因为外部重渲染丢焦点 / 丢光标。
 */
export function SearchInput({
  value,
  defaultValue = "",
  onSearch,
  onChange,
  placeholder = "搜索",
  label = "搜索",
  delay = 180,
  className,
  autoFocus = false,
}: SearchInputProps) {
  const [inner, setInner] = useState(value ?? defaultValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isControlled = value !== undefined;

  // 外部受控值变化时同步
  useEffect(() => {
    if (isControlled) setInner(value);
  }, [isControlled, value]);

  // 卸载时清理定时器
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setInner(next);
      onChange?.(next);

      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onSearch(next);
        // 收回焦点并把光标置于末尾，保持连续输入体验
        const input = inputRef.current;
        if (input) {
          input.focus();
          const end = input.value.length;
          input.setSelectionRange(end, end);
        }
      }, delay);
    },
    [delay, onChange, onSearch],
  );

  const classes = ["input", className].filter(Boolean).join(" ");

  return (
    <input
      ref={inputRef}
      type="search"
      className={classes}
      aria-label={label}
      placeholder={placeholder}
      value={inner}
      autoFocus={autoFocus}
      onChange={handleInput}
    />
  );
}
