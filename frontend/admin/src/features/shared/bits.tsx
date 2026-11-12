/* ==========================================================================
   知行测评 · 管理端通用片段
   --------------------------------------------------------------------------
   原型 admin.js 里的 statusBadge / sourceBadge / paperBadge / typeBadge /
   tagChips / difficultyChip / scopeLabel 的 React 化。
   ========================================================================== */

import type { ReactNode } from "react";
import { Badge, TagChip, type BadgeTone } from "@exam/shared";
import { TYPE_LABEL } from "@exam/shared/engine/paper";
import {
  QUESTION_SOURCE_LABEL,
  QUESTION_STATUS_LABEL,
  difficultyLabel,
  getTag,
} from "@exam/shared/mock/catalog";
import type { ExamPaper, Practice, Question, QuestionStatus } from "@exam/shared/domain/types";

/** 题型徽标。 */
export function TypeBadge({ type }: { type: string }): ReactNode {
  const tone: BadgeTone =
    type === "single" ? "primary" : type === "multi" ? "info" : type === "short" ? "warn" : "neutral";
  return <Badge tone={tone}>{TYPE_LABEL[type as keyof typeof TYPE_LABEL] ?? type}</Badge>;
}

/** 题目状态徽标。 */
export function StatusBadge({ status }: { status: QuestionStatus }): ReactNode {
  const tone: BadgeTone =
    status === "published" ? "ok" : status === "draft" ? "warn" : "neutral";
  return <Badge tone={tone}>{QUESTION_STATUS_LABEL[status]}</Badge>;
}

/** 题目来源徽标。 */
export function SourceBadge({ source }: { source: Question["source"] }): ReactNode {
  const tone: BadgeTone =
    source === "import" ? "info" : source === "ai" ? "primary" : "neutral";
  return <Badge tone={tone}>{QUESTION_SOURCE_LABEL[source]}</Badge>;
}

/** 卷对象状态徽标。 */
export function PaperBadge({ kind, item }: { kind: "exam" | "practice"; item: ExamPaper | Practice }): ReactNode {
  if (kind === "exam") {
    const exam = item as ExamPaper;
    const label =
      exam.status === "ongoing" ? "进行中" : exam.status === "ended" ? "已结束" : "未发布";
    const tone: BadgeTone =
      exam.status === "ongoing" ? "ok" : exam.status === "ended" ? "neutral" : "warn";
    return <Badge tone={tone}>{label}</Badge>;
  }
  const practice = item as Practice;
  const label = practice.status === "published" ? "已上架" : "未上架";
  const tone: BadgeTone = practice.status === "published" ? "ok" : "warn";
  return <Badge tone={tone}>{label}</Badge>;
}

/** 实体的标签片（可限量）。 */
export function TagChips({ tags, limit }: { tags: readonly string[]; limit?: number }): ReactNode {
  const shown = limit ? tags.slice(0, limit) : tags;
  const rest = tags.length - shown.length;
  return (
    <span className="tag-chips">
      {shown.map((tagId) => {
        const tag = getTag(tagId);
        if (!tag) return null;
        return (
          <TagChip key={tagId} group={tag.group} title={tag.name}>
            {tag.name}
          </TagChip>
        );
      })}
      {rest > 0 ? <span className="tag-chip is-more">+{rest}</span> : null}
    </span>
  );
}

/** 难度标签片。 */
export function DifficultyChip({ tags }: { tags: readonly string[] }): ReactNode {
  return (
    <TagChip group="difficulty" title="难度">
      {difficultyLabel({ tags: [...tags] })}
    </TagChip>
  );
}

