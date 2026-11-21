/* ==========================================================================
   能力画像的 DTO 适配
   --------------------------------------------------------------------------
   这一层要对的两件事：
   1. 读画像走 `GET /abilities/profile`（服务端已按当前登录者过滤）；
   2. **掌握度原样带过来**——接口给的是 0..1 的小数，换算成百分数是展示层的事
      （前端换算一次、服务端再换算一次，两边就会差一个数量级）。
   ========================================================================== */

import { describe, expect, it, vi } from "vitest";
import { loadAbilityProfile, toAbilityProfileItem, type AbilityClient } from "../abilityApi";

/** 服务端给的一条能力画像。 */
const ITEM = {
  abilityTagId: 12,
  tagName: "计算能力",
  masteryRate: 0.8482,
  sampleSize: 5,
  correctCount: 5,
  sampleSufficient: true,
  masteryLabel: "掌握",
};

describe("abilityApi · 能力画像", () => {
  it("读画像走 GET /abilities/profile", async () => {
    const get = vi.fn(async (_path: string) => ({ items: [ITEM], total: 1, insufficientCount: 0 }));
    const client = { get } as unknown as AbilityClient;

    const profile = await loadAbilityProfile(client);

    expect(get.mock.calls[0]![0]).toBe("/abilities/profile");
    expect(profile.total).toBe(1);
    expect(profile.insufficientCount).toBe(0);
    expect(profile.items.length).toBe(1);
  });

  it("掌握度是 0..1 的小数，原样带过（不换算成百分数）", () => {
    const item = toAbilityProfileItem(ITEM);

    expect(item.masteryRate).toBe(0.8482);
    expect(item.abilityTagId).toBe("12");
    expect(item.tagName).toBe("计算能力");
    expect(item.sampleSize).toBe(5);
    expect(item.correctCount).toBe(5);
    expect(item.sampleSufficient).toBe(true);
    // 分档文案由服务端给，前端照抄。
    expect(item.masteryLabel).toBe("掌握");
  });

  it("样本不足的项照服务端说的标出来", () => {
    const item = toAbilityProfileItem({
      ...ITEM,
      sampleSize: 2,
      correctCount: 0,
      sampleSufficient: false,
      masteryLabel: "样本不足",
    });

    expect(item.sampleSufficient).toBe(false);
    expect(item.masteryLabel).toBe("样本不足");
  });

  it("汇总数字段缺失时兜底用列表本身算，不出现「有 3 项但总数是 0」", async () => {
    const get = vi.fn(async () => ({ items: [ITEM, { ...ITEM, abilityTagId: 13, sampleSufficient: false }] }));
    const client = { get } as unknown as AbilityClient;

    const profile = await loadAbilityProfile(client);

    expect(profile.total).toBe(2);
    expect(profile.insufficientCount).toBe(1);
  });

  it("没有画像时是空列表（不是 null）", async () => {
    const get = vi.fn(async () => ({ items: [], total: 0, insufficientCount: 0 }));
    const client = { get } as unknown as AbilityClient;

    const profile = await loadAbilityProfile(client);

    expect(profile.items).toEqual([]);
    expect(profile.total).toBe(0);
    expect(profile.insufficientCount).toBe(0);
  });
});
