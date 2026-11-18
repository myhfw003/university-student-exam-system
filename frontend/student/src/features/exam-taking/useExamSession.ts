/* ==========================================================================
   知行测评 · 考试会话分派
   --------------------------------------------------------------------------
   答题页只认 `ExamSessionController` 这一个接口；
   mock 模式与 HTTP 模式各有一份实现，由这里按数据源分派。

   两个实现都**无条件调用**，靠 `enabled` 开关决定谁真正动手——
   这样既满足 React 的 Hook 规则，也不会出现两套实现同时改会话状态。
   ========================================================================== */

import { isBackendEnabled } from "@exam/shared/api";
import type { ExamSessionController } from "./examSessionTypes";
import { useLocalExamSession } from "./useLocalExamSession";
import { useRemoteExamSession } from "./useRemoteExamSession";

export type { ExamSessionController, SessionBlockReason } from "./examSessionTypes";

/**
 * 考试会话控制器。
 *
 * @param examId mock 模式是试卷 ID；HTTP 模式是考试场次 ID。
 */
export function useExamSession(examId: string): ExamSessionController {
  const remote = isBackendEnabled();
  const local = useLocalExamSession(examId, !remote);
  const remoteSession = useRemoteExamSession(examId, remote);
  return remote ? remoteSession : local;
}
