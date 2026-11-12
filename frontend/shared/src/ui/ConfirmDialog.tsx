import type { ReactNode } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";

export interface ConfirmDialogProps {
  open: boolean;
  title?: ReactNode;
  /** 提示正文。 */
  message: ReactNode;
  onCancel: () => void;
  /** 点击确认后调用；返回 Promise 时按钮进入加载态。 */
  onConfirm: () => void | Promise<void>;
  confirmText?: string;
  cancelText?: string;
  /** 确认按钮色调。 */
  confirmVariant?: "primary" | "danger";
  className?: string | undefined;
}

/**
 * 二次确认对话框。原型 .dlg-confirm 的 React 化。
 */
export function ConfirmDialog({
  open,
  title = "确认操作",
  message,
  onCancel,
  onConfirm,
  confirmText = "确认",
  cancelText = "取消",
  confirmVariant = "primary",
  className,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      className={className}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button variant={confirmVariant} onClick={() => void onConfirm()}>
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="text-2">{message}</p>
    </Dialog>
  );
}
