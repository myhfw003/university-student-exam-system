/* ==========================================================================
   知行测评 · 练习会话分派
   --------------------------------------------------------------------------
   答题页只认 `PracticeSessionController` 这一个接口；
   mock 模式与 HTTP 模式各有一份实现，由这里按数据源分派。

   两个实现都**无条件调用**，靠 `enabled` 开关决定谁真正动手——
   这样既满足 React 的 Hook 规则，也不会出现两套实现同时改会话状态。
   ========================================================================== */

import { isBackendEnabled } from "@exam/shared/api";
import type { PracticeSessionController } from "./practiceSessionTypes";
import { useLocalPracticeSession } from "./useLocalPracticeSession";
import { useRemotePracticeSession } from "./useRemotePracticeSession";

export type { PracticeSessionController } from "./practiceSessionTypes";

/**
 * 练习会话控制器。
 *
 * @param assignmentId mock 模式是练习 ID；HTTP 模式是练习开放单 ID。
 */
export function usePracticeSession(assignmentId: string): PracticeSessionController {
  const remote = isBackendEnabled();
  const local = useLocalPracticeSession(assignmentId, !remote);
  const remoteSession = useRemotePracticeSession(assignmentId, remote);
  return remote ? remoteSession : local;
}
