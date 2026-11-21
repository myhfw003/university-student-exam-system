/* ==========================================================================
   知行测评 · 系统级设置（mock）
   --------------------------------------------------------------------------
   mock 模式下这一项的后端就是内存里的这份 store；
   HTTP 模式走真实后端的 `GET/PUT /settings`（见 `shared/src/api/settingsApi.ts`）。
   ========================================================================== */

import { create } from "zustand";
import {
  DEFAULT_MISTAKE_RESOLUTION_POLICY,
  type MistakeResolutionPolicy,
  type SystemSettings,
} from "../domain/settings";

/** mock 的系统级设置状态。 */
interface MockSettingsState {
  settings: SystemSettings;
  /** 改口径。 */
  setMistakeResolutionPolicy: (policy: MistakeResolutionPolicy) => void;
}

/** 系统级设置 store。 */
export const useMockSettings = create<MockSettingsState>((set) => ({
  settings: {
    mistakeResolutionPolicy: DEFAULT_MISTAKE_RESOLUTION_POLICY,
    updatedAt: null,
    updatedBy: null,
  },
  setMistakeResolutionPolicy: (policy) =>
    set((state) => ({
      settings: {
        ...state.settings,
        mistakeResolutionPolicy: policy,
        updatedAt: new Date().toISOString(),
        updatedBy: "当前管理员",
      },
    })),
}));

/** 复位到缺省值（测试之间互不干扰）。 */
export function resetMockSettings(): void {
  useMockSettings.setState({
    settings: {
      mistakeResolutionPolicy: DEFAULT_MISTAKE_RESOLUTION_POLICY,
      updatedAt: null,
      updatedBy: null,
    },
  });
}
