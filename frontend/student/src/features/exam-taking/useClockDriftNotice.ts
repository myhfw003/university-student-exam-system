/* ==========================================================================
   时钟偏移提示（FR-DLV-04）
   --------------------------------------------------------------------------
   「客户端定期与服务端同步时钟偏移，偏移突变超过阈值时提示用户并以服务端时间为准」。

   偏移的**判定**在 `lib/useServerTime.ts` 里（阈值 5 秒）；
   这里只负责把判定结果告诉用户——考试中改系统时间，用户要看得见。
   ========================================================================== */

import { useEffect } from "react";
import { toast } from "@exam/shared";

/** 偏移突变时的提示语。 */
const DRIFT_NOTICE = "检测到本机时间异常，已以服务器时间为准";

/**
 * 时钟偏移提示：偏移突变时提示一次。
 *
 * @param driftDetected 是否检测到时钟偏移突变。
 */
export function useClockDriftNotice(driftDetected: boolean): void {
  useEffect(() => {
    if (!driftDetected) return;
    toast.info(DRIFT_NOTICE);
  }, [driftDetected]);
}
