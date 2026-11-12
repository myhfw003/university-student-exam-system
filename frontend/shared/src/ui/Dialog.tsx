import { useCallback, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface DialogProps {
  /** 是否打开。 */
  open: boolean;
  /** 关闭回调（点击遮罩、Esc、关闭按钮均触发）。 */
  onClose: () => void;
  /** 标题。 */
  title: ReactNode;
  children?: ReactNode;
  /** 底部操作区。 */
  footer?: ReactNode;
  /** 右上角关闭按钮的无障碍名称。 */
  closeLabel?: string;
  /** 关闭按钮。 */
  showClose?: boolean;
  /** 自定义类名（作用于 <dialog>）。 */
  className?: string | undefined;
  /** 打开时聚焦的元素选择器；缺省聚焦第一个可聚焦元素。 */
  initialFocusSelector?: string | undefined;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * 模态对话框。基于原生 `<dialog>`，补齐：
 * - 初始焦点
 * - 焦点陷阱（Tab / Shift+Tab 循环）
 * - 关闭后焦点归还给触发元素
 * - 背景滚动锁定
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel = "关闭",
  showClose = true,
  className,
  initialFocusSelector,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const previousOverflowRef = useRef<string | null>(null);

  // 打开：showModal + 记录触发元素 + 锁定滚动 + 设置初始焦点
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        restoreFocusRef.current = document.activeElement as HTMLElement | null;
        if (typeof dialog.showModal === "function") {
          dialog.showModal();
        } else {
          dialog.setAttribute("open", "");
        }
      }
      previousOverflowRef.current = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      const target = initialFocusSelector
        ? dialog.querySelector<HTMLElement>(initialFocusSelector)
        : (getFocusable(dialog)[0] ?? dialog);
      // 原生 <dialog> 打开后浏览器会把焦点放在 dialog 自身，这里再显式落到目标元素
      window.requestAnimationFrame(() => target?.focus());
    } else if (dialog.open) {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    }

    return () => {
      if (!open) return;
      if (previousOverflowRef.current !== null) {
        document.body.style.overflow = previousOverflowRef.current;
        previousOverflowRef.current = null;
      }
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 关闭后归还焦点（覆盖 unmount 之外的路径，例如 Esc 触发原生 close）
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      if (previousOverflowRef.current !== null) {
        document.body.style.overflow = previousOverflowRef.current;
        previousOverflowRef.current = null;
      }
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
      onClose();
    };
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  // 焦点陷阱：Tab 在对话框内循环
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = getFocusable(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const classes = ["dlg", className].filter(Boolean).join(" ");

  return (
    <dialog
      ref={dialogRef}
      className={classes}
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        // 交由 React 状态统一管理关闭
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // 点击 ::backdrop 时事件目标是 dialog 本身
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="dlg-head">
        <h2 className="dlg-title" id={titleId}>
          {title}
        </h2>
        {showClose ? (
          <button type="button" className="icon-btn" aria-label={closeLabel} onClick={onClose}>
            <svg
              className="od-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>
      <div className="dlg-body">{children}</div>
      {footer ? <div className="dlg-foot">{footer}</div> : null}
    </dialog>
  );
}
