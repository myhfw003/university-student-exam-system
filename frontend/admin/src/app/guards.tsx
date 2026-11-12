/* ==========================================================================
   知行测评 · 管理端路由守卫
   骨架阶段：尚未接入权限点，默认放行。
   接入后端后按 requirePermission('paper:publish') 等权限点判定，
   无权限时跳转 403 页（不隐藏菜单后留空白页）。
   ========================================================================== */

import { Navigate, Outlet, useLocation } from "react-router-dom";

export interface RequirePermissionProps {
  /** 需要的权限点。 */
  permission?: string;
}

/** 权限守卫。 */
export function RequirePermission({ permission }: RequirePermissionProps) {
  const location = useLocation();
  const granted = true; // 骨架：接入权限接口后改为真实判定
  const missing = permission ?? "";

  if (!granted) {
    return <Navigate to="/403" replace state={{ from: location.pathname, missing }} />;
  }
  return <Outlet />;
}
