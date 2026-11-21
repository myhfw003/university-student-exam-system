/* ==========================================================================
   知行测评 · 管理端路由守卫
   --------------------------------------------------------------------------
   按**权限点**判定，而不是按角色：同一角色在不同页面的权限不同
   （如「审计」只有系统管理员可看）。
   路由 → 权限点的映射见下表，依据 docs/design/01-requirements.md §1。

   无权限时跳到 403 页（不隐藏菜单后留空白页），并把缺少的权限点
   带上，403 页据此说明「缺哪个权限点」。
   ========================================================================== */

import { Navigate, Outlet, useLocation } from "react-router-dom";
import { hasPermission, useAuth, type PermissionPoint } from "@exam/shared";

export interface RequirePermissionProps {
  /** 需要的权限点；缺省按当前路由推导。 */
  permission?: PermissionPoint;
}

/** 路由前缀 → 权限点。前缀长者先匹配。 */
const ROUTE_PERMISSIONS: ReadonlyArray<{ prefix: string; permission: PermissionPoint }> = [
  { prefix: "/monitoring", permission: "proctor:monitor" },
  { prefix: "/exam-sessions", permission: "exam:read" },
  { prefix: "/practices", permission: "practice:read" },
  { prefix: "/roles", permission: "role:read" },
  { prefix: "/audit-logs", permission: "audit:read" },
  { prefix: "/users", permission: "user:read" },
  { prefix: "/tags", permission: "tag:read" },
  { prefix: "/banks", permission: "bank:read" },
  { prefix: "/papers", permission: "paper:read" },
  { prefix: "/review", permission: "review:grade" },
  { prefix: "/analytics", permission: "analytics:read" },
  { prefix: "/settings", permission: "system:configure" },
];

/** 按当前路径推导所需权限点；概览等页面只需登录。 */
export function requiredPermission(pathname: string): PermissionPoint | null {
  let hit: PermissionPoint | null = null;
  let hitLength = -1;
  for (const item of ROUTE_PERMISSIONS) {
    if (!pathname.startsWith(item.prefix)) continue;
    if (item.prefix.length > hitLength) {
      hit = item.permission;
      hitLength = item.prefix.length;
    }
  }
  return hit;
}

/** 加载中的占位。 */
function Loading() {
  return (
    <div className="view-inner">
      <p className="text-3 text-sm">加载中…</p>
    </div>
  );
}

/** 权限守卫。 */
export function RequirePermission({ permission }: RequirePermissionProps) {
  const location = useLocation();
  const status = useAuth((state) => state.status);
  const roles = useAuth((state) => state.user?.roles);
  const mustChangePassword = useAuth((state) => state.user?.mustChangePassword);

  if (status === "unknown") return <Loading />;

  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // 强制改密：管理员重置密码后必须先改密，其余页面一律挡住。
  if (mustChangePassword && location.pathname !== "/change-password") {
    return (
      <Navigate to="/change-password" replace state={{ from: location.pathname }} />
    );
  }

  const need = permission ?? requiredPermission(location.pathname);
  if (need && !hasPermission(roles, need)) {
    return <Navigate to="/403" replace state={{ from: location.pathname, missing: need }} />;
  }

  return <Outlet />;
}
