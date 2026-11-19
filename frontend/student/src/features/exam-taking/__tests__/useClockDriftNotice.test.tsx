/* ==========================================================================
   时钟偏移提示（FR-DLV-04）
   --------------------------------------------------------------------------
   偏移突变超过阈值时要提示用户——考试中改系统时间，用户得看得见。
   ========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useToastStore } from "@exam/shared";
import { useClockDriftNotice } from "../useClockDriftNotice";

describe("时钟偏移提示", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("检测到偏移突变时提示用户", () => {
    renderHook(() => useClockDriftNotice(true));

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toContain("检测到本机时间异常");
  });

  it("没有偏移突变时不提示", () => {
    renderHook(() => useClockDriftNotice(false));

    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("偏移状态不变时不重复提示", () => {
    const { rerender } = renderHook(({ drift }) => useClockDriftNotice(drift), {
      initialProps: { drift: false },
    });

    rerender({ drift: true });
    rerender({ drift: true });

    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});
