/* ==========================================================================
   知行测评 · 能力画像的后端读取
   --------------------------------------------------------------------------
   `GET /abilities/profile`：按「能力」维度的标签聚合当前学生的表现。

   **统计口径都在服务端**（design 03 §7.2）：掌握度、样本量、全对数、
   「样本不足」的判定与排序都是后端算好的，前端只呈现——
   前端再算一遍，两边的数就会对不上。

   `masteryLabel`（掌握 / 熟悉 / 薄弱 / 样本不足）是**服务端给的中文判定**，
   前端照抄展示，不另立一套词表：服务端改文案时页面不会显示成另一个名字。
   ========================================================================== */

import { httpClient } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import type { AbilityProfile, AbilityProfileItem } from "../domain/ability";

/** 能力画像接口所需的最小客户端接口。 */
export type AbilityClient = Pick<typeof httpClient, "get">;

/** 后端 DTO（宽松声明；字段以 OpenAPI 契约为准）。 */
type Dto = Record<string, unknown>;

function str(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * 映射能力画像里的一项。
 *
 * 掌握度在接口里是 0..1 的小数（后端按公式算好，四位小数），
 * 这里原样带过来，**不在前端换算成百分数**——
 * 换算只发生在展示层（formatPercent）。
 */
export function toAbilityProfileItem(dto: Dto): AbilityProfileItem {
  return {
    abilityTagId: str(dto.abilityTagId),
    tagName: str(dto.tagName),
    masteryRate: num(dto.masteryRate),
    sampleSize: num(dto.sampleSize),
    correctCount: num(dto.correctCount),
    sampleSufficient: bool(dto.sampleSufficient),
    masteryLabel: str(dto.masteryLabel),
  };
}

/**
 * 读取我的能力画像。
 *
 * 返回的 items 已按服务端的顺序排好：样本足够的在前（按掌握度降序），
 * 样本不足的排在后面、不参与排序——前端不重排。
 */
export async function loadAbilityProfile(
  client: AbilityClient = httpClient,
): Promise<AbilityProfile> {
  const dto = await client.get<Dto>(ENDPOINTS.learning.abilityProfile);
  const items = Array.isArray(dto.items) ? dto.items.map(toAbilityProfileItem) : [];

  // total / insufficientCount 是服务端给的汇总数；字段缺失时兜底用列表本身算，
  // 免得页面出现「有 3 项但总数是 0」的自相矛盾。
  return {
    items,
    total: num(dto.total, items.length),
    insufficientCount: num(
      dto.insufficientCount,
      items.filter((item) => !item.sampleSufficient).length,
    ),
  };
}
