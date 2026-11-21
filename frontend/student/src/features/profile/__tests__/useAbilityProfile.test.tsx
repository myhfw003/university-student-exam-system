/* ==========================================================================
   能力画像的 HTTP 通路
   --------------------------------------------------------------------------
   读的是服务端的数：掌握度、样本量、全对数、分档与**顺序**都是服务端给的。

   守住两条：
   1. 字段照服务端给的映射（掌握度是 0..1 的小数，不在前端换算）；
   2. **不重排**服务端的顺序——样本不足的项排在后面，是服务端的排序口径，
      前端自己按掌握度排一遍就把「不参与排序」弄丢了。
   ========================================================================== */

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRemoteAbilityProfile } from "../useAbilityProfile";

/** 服务端给的画像：样本足够的在前，样本不足的在后。 */
const PAYLOAD = {
  items: [
    {
      abilityTagId: 12,
      tagName: "计算能力",
      masteryRate: 0.8482,
      sampleSize: 5,
      correctCount: 5,
      sampleSufficient: true,
      masteryLabel: "掌握",
    },
    {
      abilityTagId: 15,
      tagName: "表达能力",
      masteryRate: 0.4,
      sampleSize: 2,
      correctCount: 0,
      sampleSufficient: false,
      masteryLabel: "样本不足",
    },
  ],
  total: 2,
  insufficientCount: 1,
};

/** 造一个最小可用的 JSON 响应。 */
function json(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

describe("能力画像 · HTTP 模式", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("读服务端的字段，且不重排服务端的顺序", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : String(input);
        if (!url.includes("/abilities/profile")) {
          throw new Error(`未预期的请求：${url}`);
        }
        return json(PAYLOAD);
      }),
    );

    const { result } = renderHook(() => useRemoteAbilityProfile(true));

    await waitFor(() => {
      expect(result.current.profile).not.toBeNull();
    });

    const profile = result.current.profile!;
    expect(profile.total).toBe(2);
    expect(profile.insufficientCount).toBe(1);

    const [first, second] = profile.items;
    expect(first?.tagName).toBe("计算能力");
    // 掌握度是 0..1 的小数：换算成百分数是展示层的事。
    expect(first?.masteryRate).toBe(0.8482);
    expect(first?.sampleSize).toBe(5);
    expect(first?.correctCount).toBe(5);
    expect(first?.sampleSufficient).toBe(true);
    expect(first?.masteryLabel).toBe("掌握");

    expect(second?.sampleSufficient).toBe(false);
    expect(second?.masteryLabel).toBe("样本不足");

    // 顺序照服务端给的：计算能力在表达能力之前。
    expect(profile.items.map((item) => item.tagName)).toEqual(["计算能力", "表达能力"]);
  });

  it("没启用时不去取数", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRemoteAbilityProfile(false));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.profile).toBeNull();
  });

  it("取不到时是 null（页面显示空态，不假装有画像）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const { result } = renderHook(() => useRemoteAbilityProfile(true));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.profile).toBeNull();
  });
});
