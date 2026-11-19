/* ==========================================================================
   知行测评 · 人员候选
   --------------------------------------------------------------------------
   两处用到「从账号里挑人」：

   - 场次负责人（阅卷教师 / 监考人员）：`PUT /exam-sessions/{id}/assignments`；
   - 阅卷任务指派：`POST /review-tasks/{id}/assign`。

   候选来自真实账号列表：**排除只有学生 / 社会人士角色的账号**，
   其余（出题教师、阅卷教师、管理员、自定义角色）都列出来——
   自定义角色也可能有阅卷权限，白名单式的过滤反而会把能干活的人挡在门外。

   能不能真的干这活由**后端**判定：没有阅卷权限的人被指派时，
   服务端会返回「该用户没有阅卷权限，不能指派阅卷任务。」，页面原样给管理员看。
   ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import { isBackendEnabled, loadUserPage } from "@exam/shared/api";

/** 不作为候选的角色码：学生与社会人士。 */
const NON_CANDIDATE_ROLE_CODES = new Set(["student", "general_user"]);

/** 候选人员。 */
export interface PersonCandidate {
  /** 用户 ID（指派时传这个）。 */
  id: string;
  /** 登录账号。 */
  account: string;
  /** 姓名。 */
  name: string;
  /** 角色码。 */
  roles: string[];
}

/**
 * 候选人员。
 *
 * `enabled` 一般跟着「指派对话框是否打开」走——没打开就不必发这个请求。
 */
export function usePeopleCandidates(enabled: boolean): {
  candidates: PersonCandidate[];
  loading: boolean;
  error: string | null;
} {
  const remote = isBackendEnabled();
  const [users, setUsers] = useState<PersonCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!remote || !enabled) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const page = await loadUserPage({ size: 200 });
        if (cancelled) return;
        setUsers(
          page.items
            .filter((user) => user.status === "active")
            .filter((user) => {
              const roles = user.roles;
              // 一个角色都没有的账号干不了活；只有学生 / 社会人士角色的也不算。
              if (roles.length === 0) return false;
              return !roles.every((code) => NON_CANDIDATE_ROLE_CODES.has(code));
            })
            .map((user) => ({
              id: user.id,
              account: user.username,
              name: user.displayName || user.username,
              roles: user.roles,
            })),
        );
      } catch (err) {
        // 拿不到候选不阻塞页面：这一栏显示原因即可。
        if (!cancelled) {
          setUsers([]);
          setError(err instanceof Error ? err.message : "候选人员加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [remote, enabled]);

  const candidates = useMemo(
    () => [...users].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN")),
    [users],
  );

  return { candidates, loading, error };
}
