/* ==========================================================================
   知行测评 · 学生端路由守卫
   骨架阶段：尚未接入 /auth/me，默认放行并标记为「未登录检查跳过」。
   接入后端后在此处按登录态与角色跳转。
   ========================================================================== */

import { Navigate, Outlet, useLocation } from "react-router-dom";

export interface RequireAuthProps {
  /** 允许的角色，缺省仅要求已登录。 */
  roles?: string[];
}

/** 登录守卫：未登录时跳转 /login 并携带原路由。 */
export function RequireAuth({ roles }: RequireAuthProps) {
  const location = useLocation();
  const authenticated = true; // 骨架：接入 /auth/me 后改为真实登录态
  const role = "student"; // 骨架：接入后从用户信息读取

  if (!authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (roles && roles.length > 0 && !roles.includes(role)) {
    return <Navigate to="/403" replace />;
  }
  return <Outlet />;
}
