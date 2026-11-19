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
  QUESTION_STATUS_LABEL,
  difficultyLabel,
  getTag,
} from "@exam/shared/mock/catalog";
import { SESSION_STATUS_LABEL } from "@exam/shared/mock/adminOps";
import type {
  ExamPaper,
  ExamSessionStatus,
  Practice,
  Question,
  QuestionStatus,
} from "@exam/shared/domain/types";
import type { QuestionTag } from "./useCatalogTags";

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

/**
 * 管理端题目来源徽标文案（原型 admin-workbench.js:78）。
 * 与共享层 catalog 的 SOURCE_LABEL 分开：原型的管理端徽标用「导入」，
 * 而共享层（跨端展示、导入批次来源）用「批量导入」，两处口径本就不同。
 */
const ADMIN_SOURCE_LABEL: Record<Question["source"], string> = {
  manual: "手工录入",
  import: "导入",
  ai: "AI 生成",
};

/** 题目来源徽标。 */
export function SourceBadge({ source }: { source: Question["source"] }): ReactNode {
  const tone: BadgeTone =
    source === "import" ? "info" : source === "ai" ? "primary" : "neutral";
  return <Badge tone={tone}>{ADMIN_SOURCE_LABEL[source]}</Badge>;
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

/** 场次状态徽标（场次列表与监考选场共用一套色调）。 */
export function SessionStatusBadge({ status }: { status: ExamSessionStatus }): ReactNode {
  const tone: BadgeTone =
    status === "in_progress"
      ? "ok"
      : status === "cancelled"
        ? "danger"
        : status === "scheduled"
          ? "warn"
          : "neutral";
  return <Badge tone={tone}>{SESSION_STATUS_LABEL[status]}</Badge>;
}

/**
 * 实体的标签片（可限量）。
 *
 * `catalog` 是标签目录：HTTP 模式来自服务端（标签 ID 是数字主键，
 * 本地目录里查不到），缺省用本地目录。
 */
export function TagChips({
  tags,
  limit,
  catalog,
}: {
  tags: readonly string[];
  limit?: number;
  catalog?: readonly QuestionTag[];
}): ReactNode {
  const shown = limit ? tags.slice(0, limit) : tags;
  const rest = tags.length - shown.length;
  return (
    <span className="tag-chips">
      {shown.map((tagId) => {
        const tag = catalog
          ? catalog.find((item) => item.id === tagId)
          : getTag(tagId);
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
export function DifficultyChip({
  tags,
  catalog,
}: {
  tags: readonly string[];
  catalog?: readonly QuestionTag[];
}): ReactNode {
  // HTTP 模式：难度标签的名字在服务端目录里，本地目录查不到。
  if (catalog) {
    const hit = catalog.find((tag) => tag.group === "difficulty" && tags.includes(tag.id));
    return (
      <TagChip group="difficulty" title="难度">
        {hit?.name ?? "未标难度"}
      </TagChip>
    );
  }
  return (
    <TagChip group="difficulty" title="难度">
      {difficultyLabel({ tags: [...tags] })}
    </TagChip>
  );
}

