/* ==========================================================================
   答题页顶栏 · 倒计时的无障碍播报
   --------------------------------------------------------------------------
   设计文档 §9：视觉倒计时对读屏隐藏，另设分钟级播报（每 60 秒一次）。
   ========================================================================== */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExamBar } from "../ExamBar";

/** 渲染一个带倒计时的顶栏。 */
function renderBar(remainingSec?: number) {
  return render(
    <ExamBar
      title="计算机网络期中考试"
      note="共 3 题"
      // 练习不计时时不传这个属性（exactOptionalPropertyTypes 不接受显式 undefined）。
      {...(remainingSec !== undefined ? { remainingSec } : {})}
      flagLabel="标记"
      onToggleFlag={() => {}}
      submitLabel="交卷"
      onSubmit={() => {}}
    />,
  );
}

describe("答题页顶栏 · 倒计时播报", () => {
  it("视觉倒计时对读屏隐藏", () => {
    renderBar(90 * 60);

    const timer = screen.getByText("01:30:00");
    expect(timer).toHaveAttribute("aria-hidden", "true");
  });

  it("按分钟播报剩余时间", () => {
    renderBar(90 * 60);

    const live = screen.getByText("剩余 90 分钟");
    expect(live).toHaveAttribute("aria-live", "polite");
  });

  it("秒数变化不重复播报，整分钟变化才更新", () => {
    const { rerender } = renderBar(90 * 60);

    // 同一分钟内的秒数变化：播报文本不变。
    rerender(
      <ExamBar
        title="计算机网络期中考试"
        note="共 3 题"
        remainingSec={89 * 60 + 30}
        flagLabel="标记"
        onToggleFlag={() => {}}
        submitLabel="交卷"
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByText("剩余 90 分钟")).toBeInTheDocument();

    // 跨过整分钟：播报更新。
    rerender(
      <ExamBar
        title="计算机网络期中考试"
        note="共 3 题"
        remainingSec={89 * 60 - 1}
        flagLabel="标记"
        onToggleFlag={() => {}}
        submitLabel="交卷"
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByText("剩余 89 分钟")).toBeInTheDocument();
  });

  it("时间到时给出明确提示", () => {
    renderBar(0);
    expect(screen.getByText("考试时间已到")).toBeInTheDocument();
  });

  it("练习不计时：没有倒计时也没有播报", () => {
    renderBar(undefined);

    expect(screen.queryByText(/剩余 \d+ 分钟/)).not.toBeInTheDocument();
    expect(screen.queryByText("考试时间已到")).not.toBeInTheDocument();
  });
});
