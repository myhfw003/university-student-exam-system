/* ==========================================================================
   知行测评 · 修改密码表单
   --------------------------------------------------------------------------
   两个 SPA 共用：个人中心的常规改密、强制改密页都走这套表单。
   表单只管输入与确认口令的校验，真正的校验在后端（改密必须过原密码）。
   ========================================================================== */

import { useState } from "react";
import { Button, Callout, Field, TextInput } from "../ui/index";

export interface ChangePasswordFormProps {
  /**
   * 提交回调。
   * <para>返回错误信息表示失败；返回 null 表示成功。</para>
   */
  onSubmit: (current: string, next: string) => Promise<string | null>;
  /** 按钮文案。 */
  submitText?: string;
  /** 成功后回调（用于跳转）。 */
  onSuccess?: () => void;
}

/** 修改密码表单。 */
export function ChangePasswordForm({
  onSubmit,
  submitText = "修改密码",
  onSuccess,
}: ChangePasswordFormProps) {
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    setError(null);

    if (passwords.next !== passwords.confirm) {
      setError("两次输入的新密码不一致");
      return;
    }

    setBusy(true);
    try {
      const message = await onSubmit(passwords.current, passwords.next);
      if (message) {
        setError(message);
        return;
      }
      setPasswords({ current: "", next: "", confirm: "" });
      onSuccess?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {error ? (
        <Callout tone="danger" title="修改失败">
          {error}
        </Callout>
      ) : null}
      <Field label="原密码" required htmlFor="pwd-current">
        <TextInput
          id="pwd-current"
          type="password"
          autoComplete="current-password"
          value={passwords.current}
          onChange={(e) =>
            setPasswords((prev) => ({ ...prev, current: e.target.value }))
          }
        />
      </Field>
      <Field label="新密码" required htmlFor="pwd-next">
        <TextInput
          id="pwd-next"
          type="password"
          autoComplete="new-password"
          value={passwords.next}
          onChange={(e) =>
            setPasswords((prev) => ({ ...prev, next: e.target.value }))
          }
        />
      </Field>
      <Field label="确认新密码" required htmlFor="pwd-confirm">
        <TextInput
          id="pwd-confirm"
          type="password"
          autoComplete="new-password"
          value={passwords.confirm}
          onChange={(e) =>
            setPasswords((prev) => ({ ...prev, confirm: e.target.value }))
          }
        />
      </Field>
      <div>
        <Button variant="primary" disabled={busy} onClick={() => void handleSubmit()}>
          {busy ? "提交中…" : submitText}
        </Button>
      </div>
    </div>
  );
}
