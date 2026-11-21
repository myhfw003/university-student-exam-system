/* ==========================================================================
   知行测评 · 学生端能力画像
   --------------------------------------------------------------------------
   两条数据通路各一份实现，页面只认 `AbilityProfile`：

   - mock 模式：本地内容仓库里的能力画像（按当前答题者隔离）；
   - HTTP 模式：`GET /abilities/profile`（服务端已按当前登录者过滤）。

   **统计口径都在服务端**：掌握度、样本量、全对数与「样本不足」的判定都是
   服务端算好的，前端只呈现——前端再算一遍，两边的数会对不上。
   ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import { isBackendEnabled, loadAbilityProfile } from "@exam/shared/api";
import type { AbilityProfile, AbilityProfileItem } from "@exam/shared/domain/ability";
import { useCatalog } from "@exam/shared/mock/catalog";
import { useStudentStore } from "@/stores/studentStore";

/** 空画像。 */
const EMPTY: AbilityProfile = { items: [], total: 0, insufficientCount: 0 };

/**
 * mock 模式的能力画像。
 *
 * 示例数据的标签名由标签表带出（改了标签名，画像跟着改），
 * 汇总数由示例行数出来——mock 没有服务端，统计口径自然不同。
 */
export function useLocalAbilityProfile(): AbilityProfile {
  const studentId = useStudentStore((state) => state.studentId);
  const seeds = useCatalog((state) => state.abilityProfiles);
  const tags = useCatalog((state) => state.tags);

  return useMemo(() => {
    const items: AbilityProfileItem[] = seeds
      .filter((seed) => seed.studentId === studentId)
      .map((seed) => ({
        abilityTagId: seed.abilityTagId,
        tagName: tags.find((tag) => tag.id === seed.abilityTagId)?.name ?? seed.abilityTagId,
        masteryRate: seed.masteryRate,
        sampleSize: seed.sampleSize,
        correctCount: seed.correctCount,
        sampleSufficient: seed.sampleSufficient,
        masteryLabel: seed.masteryLabel,
      }));

    return {
      items,
      total: items.length,
      insufficientCount: items.filter((item) => !item.sampleSufficient).length,
    };
  }, [seeds, tags, studentId]);
}

/** HTTP 模式的能力画像。 */
export function useRemoteAbilityProfile(enabled: boolean): {
  profile: AbilityProfile | null;
  loading: boolean;
} {
  const [profile, setProfile] = useState<AbilityProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const loaded = await loadAbilityProfile();
        if (!cancelled) setProfile(loaded);
      } catch {
        if (!cancelled) setProfile(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { profile: enabled ? profile : null, loading };
}

/** 能力画像（按数据源分派）。 */
export function useAbilityProfile(): { profile: AbilityProfile | null; loading: boolean } {
  const remote = isBackendEnabled();
  const local = useLocalAbilityProfile();
  const remoteProfile = useRemoteAbilityProfile(remote);

  return remote ? remoteProfile : { profile: local, loading: false };
}

export { EMPTY as EMPTY_ABILITY_PROFILE };
