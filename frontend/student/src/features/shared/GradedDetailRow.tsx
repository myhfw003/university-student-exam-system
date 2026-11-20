/* ==========================================================================
   知行测评 · 逐题明细行（学生端）
   --------------------------------------------------------------------------
   对应原型 docs/ui-design/exam/js/student.js 的两处逐题明细：
   - 成绩报告 student.js:1344：78px 列，副行是「第 N 题 · 题型」；
   - 练习解析 student.js:863：64px 列，副行只有题型。
   两处的其余结构一致：题干 → 副行 → 标签片 → 作答摘要 → 评分要点 / 步骤
   → 查看解析。

   状态徽标沿用原型 statusBadge（student.js:904）：
   正确 / 部分正确 / 错误 / 未作答 / 待阅。
   主观题在练习侧按得分折算（原型 practiceStatus，student.js:1764），
   报告侧则直接用判分状态。
   ========================================================================== */

import {
  Analysis,
  Badge,
  KeypointList,
  TYPE_LABEL,
  formatScore,
  keypointItems,
  stepItems,
} from "@exam/shared";
import type { BadgeTone } from "@exam/shared";
import type { GradedDetail } from "@exam/shared/engine/scoring";
import { AnswerSummary } from "./AnswerSummary";
import { TagChips } from "./TagChips";

/** 原型 statusBadge 的状态 → 文案与色调（student.js:904）。 */
const STATUS_META = {
  correct: { label: "正确", tone: "ok" },
  partial: { label: "部分正确", tone: "warn" },
  wrong: { label: "错误", tone: "danger" },
  blank: { label: "未作答", tone: "neutral" },
  pending: { label: "待阅", tone: "info" },
  auto: { label: "待阅", tone: "info" },
} as const satisfies Record<string, { label: string; tone: BadgeTone }>;

/** 已知状态的键。 */
type StatusKey = keyof typeof STATUS_META;

/** 取状态徽标；未知状态按中性处理。 */
function metaOf(status: string): { label: string; tone: BadgeTone } {
  if (status in STATUS_META) return STATUS_META[status as StatusKey];
  return { label: status, tone: "neutral" };
}

/**
 * 练习侧的状态：主观题按得分折算（原型 practiceStatus，student.js:1764）。
 *
 * 得分达到满分记「正确」，拿到部分分记「部分正确」，一分不得记「错误」，
 * 没作答记「未作答」；客观题直接用判分状态。
 */
function practiceStatus(detail: GradedDetail): { label: string; tone: BadgeTone } {
  if (detail.type === "short" || detail.type === "comprehensive") {
    if (detail.status === "blank") return STATUS_META.blank;
    if (detail.score >= detail.max) return STATUS_META.correct;
    if (detail.score > 0) return STATUS_META.partial;
    return STATUS_META.wrong;
  }
  return metaOf(detail.status);
}

/** 逐题明细行的形态。 */
export type GradedDetailRowVariant = "report" | "practice";

export interface GradedDetailRowProps {
  /** 判分明细。 */
  detail: GradedDetail;
  /** 形态：report = 成绩报告（带题号、78px 列）；practice = 练习解析（64px 列）。 */
  variant: GradedDetailRowVariant;
}

/** 逐题明细行。 */
export function GradedDetailRow({ detail, variant }: GradedDetailRowProps) {
  const status = variant === "practice" ? practiceStatus(detail) : metaOf(detail.status);
  const typeLabel = TYPE_LABEL[detail.type] ?? detail.type;

  return (
    <div
      className="list-row"
      style={{
        gridTemplateColumns:
          variant === "report" ? "78px minmax(0,1fr)" : "64px minmax(0,1fr)",
      }}
    >
      <div>
        <Badge tone={status.tone}>{status.label}</Badge>
        <div className="text-xs text-3 num" style={{ marginTop: 4 }}>
          {formatScore(detail.score)}/{formatScore(detail.max)}
        </div>
      </div>
      <div className="list-main">
        <div className="list-title">{detail.question.stem}</div>
        <div className="list-sub">
          {variant === "report" ? `第 ${detail.slot} 题 · ` : ""}
          {typeLabel}
        </div>
        {/* 原型 student.js:1349 / 868：标签片按自身分组着色，紧跟副行。 */}
        <div className="row-tight" style={{ marginTop: 6 }}>
          <TagChips tags={detail.question.tags} />
        </div>
        <AnswerSummary detail={detail} />
        {detail.points ? (
          <KeypointList
            items={keypointItems(detail.points)}
            style={{ marginTop: "var(--sp-2)" }}
          />
        ) : null}
        {detail.steps ? (
          <KeypointList
            items={stepItems(detail.steps)}
            style={{ marginTop: "var(--sp-2)" }}
          />
        ) : null}
        {/*
          判分依据：服务端给的「命中了哪些要点、漏了哪些」。
          要点的分值分布前端算不出来（阅卷教师可能改过分），所以只给命中与否。
        */}
        {detail.hitItems?.length || detail.missedItems?.length ? (
          <>
            <div className="text-sm text-3" style={{ marginTop: "var(--sp-2)" }}>
              判分依据
            </div>
            <KeypointList
              items={[
                ...(detail.hitItems ?? []).map((text) => ({ text, hit: true })),
                ...(detail.missedItems ?? []).map((text) => ({ text, hit: false })),
              ]}
              style={{ marginTop: "var(--sp-1)" }}
            />
          </>
        ) : null}
        <details>
          <summary className="text-sm">查看解析</summary>
          <Analysis>
            {detail.question.analysis || detail.question.reference || "暂无解析"}
          </Analysis>
        </details>
      </div>
    </div>
  );
}
