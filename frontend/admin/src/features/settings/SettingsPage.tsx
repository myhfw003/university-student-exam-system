/* ==========================================================================
   知行测评 · 管理端系统设置
   --------------------------------------------------------------------------
   全局生效的开关：管理员改一次，所有人一起变。
   学生端没有单独的入口——要改就到这里改。

   读与写都要权限点 `system:configure`（需求文档 §1 的矩阵里只给系统管理员）。
   ========================================================================== */

import { useEffect, useState } from "react";
import { Button, Card, PageHead, Segmented, toast } from "@exam/shared";
import {
  MISTAKE_RESOLUTION_POLICY,
  MISTAKE_RESOLUTION_POLICY_HINT,
  MISTAKE_RESOLUTION_POLICY_LABEL,
  type MistakeResolutionPolicy,
} from "@exam/shared/domain/settings";
import { saveSystemSettings, useSystemSettings } from "./useSystemSettings";

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
