/* ==========================================================================
   知行测评 · 服务端时钟数据源
   --------------------------------------------------------------------------
   调后端 GET /api/v1/system/time（已实现），返回服务端当前时间。
   ========================================================================== */

import { ENDPOINTS } from "@exam/shared/api";
import type { ServerTimeSource } from "./useServerTime";

/** 服务端时钟响应体。 */
interface ServerTimePayload {
  serverTime: string;
  monotonicTime: number;
}

/** 基于后端接口的服务端时钟源。 */
export function createHttpServerTimeSource(baseUrl = ""): ServerTimeSource {
  return {
    async fetch(): Promise<number> {
      const response = await fetch(`${baseUrl}${ENDPOINTS.system.time}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`服务端时间获取失败：HTTP ${response.status}`);
      }
      const payload = (await response.json()) as ServerTimePayload;
      const parsed = Date.parse(payload.serverTime);
      if (Number.isNaN(parsed)) {
        throw new Error("服务端时间响应格式不正确。");
      }
      return parsed;
    },
  };
}
