/* ==========================================================================
   知行测评 · 管理端实体标签对话框
   --------------------------------------------------------------------------
   对应原型 admin.js 的 openEntityTags + admin/index.html 的 dlg-entity-tags：
   给试卷 / 练习挂载标签的弹窗。保存走 catalog.setEntityTags。
   ========================================================================== */

import { useEffect, useState } from "react";
import { Button, Dialog, toast } from "@exam/shared";
import { MAX_TAGS, setEntityTags } from "@exam/shared/mock/catalog";
import { TagPicker } from "./TagPicker";
import type { QuestionTag } from "./useCatalogTags";

/** 待编辑标签的实体。 */
export interface EntityTagsTarget {
  kind: "exam" | "practice";
  id: string;
  name: string;
  /** 实体当前的标签 ID。 */
  tags: readonly string[];
}

export interface EntityTagsDialogProps {
  /** 目标实体；null 表示弹窗未打开。 */
  target: EntityTagsTarget | null;
  onClose: () => void;
  /**
   * 保存回调。
   *
   * HTTP 模式：标签挂到服务端的卷对象上（`PUT /papers/{id}` 的 `tagIds`），
   * 由页面给；缺省时走本地 mock。
   */
  onSave?: (tags: string[]) => Promise<void> | void;
  /** 标签目录（HTTP 模式来自服务端）。 */
  catalogTags?: readonly QuestionTag[];
}

/**
 * 实体标签弹窗。标题、说明与提示文案照抄原型 openEntityTags。
 */
export function EntityTagsDialog({
  target,
  onClose,
  onSave,
  catalogTags,
}: EntityTagsDialogProps) {
  const [draft, setDraft] = useState<string[]>([]);

  // 打开时载入实体当前的标签。
  useEffect(() => {
    setDraft(target ? [...target.tags] : []);
  }, [target]);

  const handleSave = async () => {
    if (!target) return;
    if (onSave) {
      try {
        await onSave(draft);
        toast.ok("标签已更新");
        onClose();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "标签保存失败");
      }
      return;
    }
    const result = setEntityTags(target.kind, target.id, draft);
    if (!result.ok) {
      toast.error(result.message ?? "标签保存失败");
      return;
    }
    toast.ok("标签已更新");
    onClose();
  };

  const isExam = target?.kind === "exam";

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={
        target
          ? `${isExam ? "试卷标签 · " : "练习标签 · "}${target.name}`
          : "编辑标签"
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={handleSave}>
            保存标签
          </Button>
        </>
      }
    >
      <p className="section-note" style={{ marginBottom: "var(--sp-4)" }}>
        标签用于把{isExam ? "试卷" : "练习"}接入领域 / 知识点 / 能力等维度，答题端据此筛选与归档。
      </p>
      <div className="field">
        <span className="field-label">
          标签
          <span className={`tag-counter${draft.length >= MAX_TAGS ? " is-full" : ""}`}>
            {draft.length}/{MAX_TAGS}
          </span>
        </span>
        <TagPicker
          selected={draft}
          onToggle={(tagId) =>
            setDraft((prev) =>
              prev.includes(tagId)
                ? prev.filter((id) => id !== tagId)
                : [...prev, tagId],
            )
          }
          {...(catalogTags ? { tags: catalogTags } : {})}
        />
        <span className="field-hint">
          单个对象最多挂载 5 个标签；选满后其余标签会被置灰。
        </span>
      </div>
    </Dialog>
  );
}
