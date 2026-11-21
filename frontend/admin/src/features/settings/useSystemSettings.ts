/* ==========================================================================
   知行测评 · 管理端系统级设置数据通路
   --------------------------------------------------------------------------
   系统级设置是**全局**的开关：管理员改一次，所有人一起变，
   学生端没有单独的入口。

   mock 与真实后端各一份，页面只认统一形状。
   ========================================================================== */

import { useCallback, useEffect, useState } from "react";
import {
  isBackendEnabled,
  loadSystemSettings,
  updateSystemSettings,
} from "@exam/shared/api";
import {
  DEFAULT_MISTAKE_RESOLUTION_POLICY,
  type MistakeResolutionPolicy,
  type SystemSettings,
} from "@exam/shared/domain/settings";
import { useMockSettings } from "@exam/shared/mock/settings";

/** 没配置过时的缺省值。 */
const FALLBACK: SystemSettings = {
  mistakeResolutionPolicy: DEFAULT_MISTAKE_RESOLUTION_POLICY,
  updatedAt: null,
  updatedBy: null,
};

/**
 * 读系统级设置。
 *
 * HTTP 模式读 `GET /settings`：后端给的是**生效值**（没配置过就给默认值），
 * 不是空——页面不用自己判断「空是不是默认值」。
 */
export function useSystemSettings(): {
  settings: SystemSettings;
  loading: boolean;
  /** 重新拉一次（保存后调用，让「最后修改」显示成最新的）。 */
  refresh: () => void;
} {
  const remote = isBackendEnabled();
  const mockSettings = useMockSettings((state) => state.settings);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const loaded = await loadSystemSettings();
        if (!cancelled) setSettings(loaded);
      } catch {
        // 读不到就退回默认值：页面照样能用，只是显示的不是真实配置。
        if (!cancelled) setSettings(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, token]);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  return {
    settings: remote ? (settings ?? FALLBACK) : mockSettings,
    loading,
    refresh,
  };
}

/**
 * 改系统级设置。
 *
 * 返回 `{ ok, message }`：失败时把后端的说法原样带出去，
 * 页面直接显示，不另写一套提示。
 */
export async function saveSystemSettings(
  mistakeResolutionPolicy: MistakeResolutionPolicy,
): Promise<{ ok: boolean; message?: string }> {
  if (!isBackendEnabled()) {
    useMockSettings.getState().setMistakeResolutionPolicy(mistakeResolutionPolicy);
    return { ok: true };
  }

  try {
    await updateSystemSettings(mistakeResolutionPolicy);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error && error.message ? error.message : "保存失败",
    };
  }
}
