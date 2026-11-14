/* ==========================================================================
   逐题明细行（学生端）
   --------------------------------------------------------------------------
   覆盖原型 student.js:1344（成绩报告）与 student.js:863（练习解析）两处：
   - 报告副行带题号，练习副行只有题型；
   - 标签片按自身分组着色；
   - 状态徽标：报告用判分状态，练习对主观题按得分折算（prototype practiceStatus）。
   ========================================================================== */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GradedDetailRow } from "../GradedDetailRow";
import { getQuestion } from "@exam/shared/mock/catalog";
import type { GradedDetail } from "@exam/shared/engine/scoring";

/** 取一道真实题目，构造判分明细。 */
function detailOf(qid: string, overrides: Partial<GradedDetail> = {}): GradedDetail {
  const question = getQuestion(qid);
  if (!question) throw new Error(`题目不存在：${qid}`);
  return {
    qid: question.id,
    slot: 3,
    type: question.type,
    question,
    displayKeys: [],
    toOriginal: {},
    fromOriginal: {},
    score: 0,
    max: question.score,
    status: "blank",
    ...overrides,
  };
}

/** 取状态徽标的文案。 */
function badgeText(container: HTMLElement): string {
  return container.querySelector(".badge")?.textContent ?? "";
}

describe("GradedDetailRow · 逐题明细行", () => {
  it("报告形态：副行带题号，标签片与评分要点都渲染出来", () => {
    const detail = detailOf("q-m-07", {
      status: "pending",
      score: 4,
      max: 10,
      points: [{ text: "要点一", hit: true, score: 4, max: 5 }],
    });

    const { container } = render(<GradedDetailRow detail={detail} variant="report" />);

    expect(screen.getByText("第 3 题 · 简答题")).toBeInTheDocument();
    // 报告侧直接用判分状态：主观题待阅就是「待阅」。
    expect(badgeText(container)).toBe("待阅");
    // 标签片按自身分组着色，不再一律染成领域色。
    expect(container.querySelector(".tag-chips")).not.toBeNull();
    // 评分要点命中清单。
    expect(screen.getByText("要点一")).toBeInTheDocument();
    expect(screen.getByText("4/5")).toBeInTheDocument();
  });

  it("练习形态：副行只有题型，不带题号", () => {
    const detail = detailOf("q-m-07", { status: "pending", score: 4, max: 10 });

    render(<GradedDetailRow detail={detail} variant="practice" />);

    expect(screen.getByText("简答题")).toBeInTheDocument();
    expect(screen.queryByText(/第 3 题/)).not.toBeInTheDocument();
  });

  it("练习形态：主观题状态按得分折算（部分得分记部分正确）", () => {
    const detail = detailOf("q-m-07", { status: "pending", score: 4, max: 10 });

    const { container } = render(<GradedDetailRow detail={detail} variant="practice" />);

    expect(badgeText(container)).toBe("部分正确");
  });

  it("练习形态：满分为正确、一分不得为错误、未作答为未作答", () => {
    const full = detailOf("q-m-07", { status: "pending", score: 10, max: 10 });
    const { container: fullBox, unmount } = render(
      <GradedDetailRow detail={full} variant="practice" />,
    );
    expect(badgeText(fullBox)).toBe("正确");
    unmount();

    const none = detailOf("q-m-07", { status: "pending", score: 0, max: 10 });
    const { container: noneBox, unmount: unmountNone } = render(
      <GradedDetailRow detail={none} variant="practice" />,
    );
    expect(badgeText(noneBox)).toBe("错误");
    unmountNone();

    const blank = detailOf("q-m-07", { status: "blank", score: 0, max: 10 });
    const { container: blankBox } = render(
      <GradedDetailRow detail={blank} variant="practice" />,
    );
    expect(badgeText(blankBox)).toBe("未作答");
  });

  it("客观题直接用判分状态，不按得分折算", () => {
    const detail = detailOf("q-m-05", { status: "partial", score: 2, max: 5 });

    const { container } = render(<GradedDetailRow detail={detail} variant="practice" />);

    expect(badgeText(container)).toBe("部分正确");
  });
});
