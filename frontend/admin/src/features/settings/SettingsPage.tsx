/* ==========================================================================
   知行测评 · 管理端系统设置
   --------------------------------------------------------------------------
   全局生效的开关：管理员改一次，所有人一起变。
   学生端没有单独的入口——要改就到这里改。

   读与写都要权限点 `system:configure`（需求文档 §1 的矩阵里只给系统管理员）。
   ========================================================================== */

import { useEffect, useState } from "react";
import { Button, Card, Field, PageHead, Segmented, TextInput, toast } from "@exam/shared";
import {
  MISTAKE_RESOLUTION_POLICY,
  MISTAKE_RESOLUTION_POLICY_HINT,
  MISTAKE_RESOLUTION_POLICY_LABEL,
  type MistakeResolutionPolicy,
} from "@exam/shared/domain/settings";
import {
  removeOriginalPassword,
  saveOriginalPassword,
  saveSystemSettings,
  useSystemSettings,
} from "./useSystemSettings";

/** 口径的取值（两档，顺序即展示顺序）。 */
const POLICY_OPTIONS: MistakeResolutionPolicy[] = [
  MISTAKE_RESOLUTION_POLICY.remove,
  MISTAKE_RESOLUTION_POLICY.keepMastered,
];

/** 系统设置页。 */
export function SettingsPage() {
  const { settings, loading, refresh } = useSystemSettings();
  const [policy, setPolicy] = useState<MistakeResolutionPolicy>(settings.mistakeResolutionPolicy);
  const [saving, setSaving] = useState(false);
  const [originalPassword, setOriginalPassword] = useState("");
  const [savingOriginal, setSavingOriginal] = useState(false);
  const [clearingOriginal, setClearingOriginal] = useState(false);

  // 后端的值回来后跟本地选择对齐：首次加载，或者别的管理员刚改过。
  useEffect(() => {
    setPolicy(settings.mistakeResolutionPolicy);
  }, [settings.mistakeResolutionPolicy]);

  const dirty = policy !== settings.mistakeResolutionPolicy;

  const handleSave = async () => {
    setSaving(true);
    const result = await saveSystemSettings(policy);
    setSaving(false);

    if (!result.ok) {
      toast.error(result.message ?? "保存失败");
      return;
    }

    toast.ok("系统设置已保存，立即生效");
    refresh();
  };

  // 原始密码的强度要求与用户密码一致：长度、字母、数字。
  const handleSetOriginalPassword = async () => {
    const value = originalPassword;
    if (value.length < 8) {
      toast.error("原始密码至少 8 位");
      return;
    }
    if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
      toast.error("原始密码要同时包含字母与数字");
      return;
    }

    setSavingOriginal(true);
    const result = await saveOriginalPassword(value);
    setSavingOriginal(false);

    if (!result.ok) {
      toast.error(result.message ?? "保存失败");
      return;
    }

    // 密码只写不回显：设好之后输入框里不留痕迹。
    setOriginalPassword("");
    toast.ok("原始密码已设置。重置用户密码时会置成它。");
    refresh();
  };

  const handleClearOriginalPassword = async () => {
    setClearingOriginal(true);
    const result = await removeOriginalPassword();
    setClearingOriginal(false);

    if (!result.ok) {
      toast.error(result.message ?? "清除失败");
      return;
    }

    toast.ok("原始密码已清除，此后重置密码会被拒绝");
    refresh();
  };

  return (
    <>
      <PageHead
        title="系统设置"
        sub="全局生效的开关：改一次，所有人一起变，学生端没有单独入口。只有系统管理员能改（权限点 system:configure）。"
        actions={
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            disabled={!dirty}
            loading={saving}
            loadingText="保存中…"
          >
            保存
          </Button>
        }
      />

      <Card
        title="错题本"
        actions={
          <span className="text-sm text-3">
            {loading
              ? "加载中…"
              : settings.updatedAt
                ? `最后修改：${formatTime(settings.updatedAt)}`
                : "从未修改"}
          </span>
        }
      >
        <div className="field">
          <span className="field-label">重做正确后怎么处理</span>
          <Segmented
            label="重做正确后怎么处理"
            value={policy}
            onChange={setPolicy}
            options={POLICY_OPTIONS.map((value) => ({
              value,
              label: MISTAKE_RESOLUTION_POLICY_LABEL[value],
            }))}
          />
          <p className="field-hint">{MISTAKE_RESOLUTION_POLICY_HINT[policy]}</p>
        </div>

        <p className="section-note" style={{ marginTop: "var(--sp-4)" }}>
          这是**系统级**设置：改完立即生效，不用重启，也没有「只对我生效」的余地。
          学生端的错题本按这个口径处理重做正确的题目。
        </p>
      </Card>

      <Card
        title="原始密码"
        actions={
          <span className="text-sm text-3">
            {loading ? "加载中…" : settings.originalPasswordConfigured ? "已配置" : "未配置"}
          </span>
        }
      >
        <Field
          label="原始密码"
          htmlFor="original-password"
          hint="管理员重置任意用户密码时置成它：用户用这个密码登录后必须立即改密，请把密码另行告知用户。密码只写不回显——设好之后系统不再显示它，请自行留存。没配置时重置密码会被拒绝。"
        >
          <TextInput
            id="original-password"
            type="password"
            value={originalPassword}
            placeholder="至少 8 位，含字母与数字"
            onChange={(e) => setOriginalPassword(e.target.value)}
          />
        </Field>

        <div className="row-tight">
          <Button
            variant="primary"
            onClick={() => void handleSetOriginalPassword()}
            disabled={!originalPassword.trim()}
            loading={savingOriginal}
            loadingText="保存中…"
          >
            设置原始密码
          </Button>
          {settings.originalPasswordConfigured ? (
            <Button
              variant="secondary"
              onClick={() => void handleClearOriginalPassword()}
              loading={clearingOriginal}
              loadingText="清除中…"
            >
              清除原始密码
            </Button>
          ) : null}
        </div>
      </Card>
    </>
  );
}

/** 最后修改时间：去掉秒，够用。 */
function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
