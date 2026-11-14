/* ==========================================================================
   知行测评 · 学生端路由守卫
   --------------------------------------------------------------------------
   判定依据是**真实登录态**（`@exam/shared` 的 useAuth）：
   - 状态未知：显示加载中，等 bootstrap 回来
   - 未登录：跳 /login，并携带原路由
   - 角色不符：跳 /403

   mock 模式下 providers 会用演示身份自动登录，守卫照常跑通；
   http 模式由 /auth/me 决定。
   ========================================================================== */

import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@exam/shared";
import type { UserRole } from "@exam/shared/domain/types";

export interface RequireAuthProps {
  /** 允许的角色，缺省仅要求已登录。 */
  roles?: readonly UserRole[];
}

/** 加载中的占位（与外壳的 view-inner 一致，避免闪白）。 */
function Loading() {
  return (
    <div className="view-inner">
      <p className="text-3 text-sm">加载中…</p>
    </div>
  );
}

/** 登录守卫。 */
export function RequireAuth({ roles }: RequireAuthProps) {
  const location = useLocation();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);

  if (status === "unknown") return <Loading />;

  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (roles && roles.length > 0) {
    const granted = roles.some((role) => user?.roles.includes(role));
    if (!granted) {
      return <Navigate to="/403" replace state={{ from: location.pathname }} />;
    }
  }

  return <Outlet />;
}
