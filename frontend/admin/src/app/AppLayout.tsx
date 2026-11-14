/* ==========================================================================
   知行测评 · 管理端应用外壳
   顶栏 + 侧栏 + 视图容器。类名沿用原型 .app / .topbar / .sidebar / .view。
   ========================================================================== */

import { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { IconButton, useAuth } from "@exam/shared";
import { useCatalog } from "@exam/shared/mock/catalog";
import { USER_ROLE_LABEL } from "@exam/shared/mock/adminOps";
import { Icon } from "./Icon";
import { ADMIN_NAV } from "./nav";
import { useThemeStore } from "./themeStore";

/**
 * 答题端入口地址。
 *
 * 生产部署：nginx 把学生端挂在站点根 `/`、管理端挂在 `/admin/`
 * （frontend/nginx.conf），因此答题端就是站点根 `/`。
 * 开发模式：管理端 dev server 跑在 5174 的根路径，答题端跑在 5173 端口。
 */
const STUDENT_APP_URL = import.meta.env.DEV ? "http://localhost:5173/" : "/";

export function AppLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const navigate = useNavigate();
  // 当前管理员身份：来自登录态（mock 模式为演示管理员，http 模式为 /auth/me）。
  const authUser = useAuth((state) => state.user);
  const signOut = useAuth((state) => state.signOut);
  // 顶栏展示**首个角色**的中文名，与原型一致（演示账号同时持有系统管理员权限，
  // 仅为让「审计」等只对系统管理员开放的页面可达）。
  const primaryRole = authUser?.roles[0];
  const roleLabel = primaryRole ? (USER_ROLE_LABEL[primaryRole] ?? primaryRole) : "";
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const location = useLocation();

  // 侧栏角标：阅卷中心显示待阅卷份数（原型是动态计算的）。
  const reviews = useCatalog((state) => state.reviews);
  const pendingCount = useMemo(
    () => reviews.filter((r) => r.status === "pending").length,
    [reviews],
  );
  const navCounts: Record<string, number> = { "/review": pendingCount };

  const isActive = (path: string): boolean => {
    if (path === "/") return location.pathname === "/";
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  return (
    <>
      <a className="skip-link" href="#view">
        跳到主要内容
      </a>
      <div className="app">
        <header className="topbar">
          <IconButton
            label="打开导航"
            className="nav-toggle"
            onClick={() => setNavOpen((open) => !open)}
          >
            <Icon name="menu" />
          </IconButton>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <Icon name="check" size={17} />
            </span>
            <span className="brand-text">
              <span className="brand-name">知行测评</span>
              <span className="brand-sub">管理端 · 在线考试与练习平台</span>
            </span>
          </div>
          <div className="topbar-spacer" />
          {/* 跨端互链：与答题端互相独立（原型 admin-config.js:25 的 otherApp）。
              管理端挂在 /admin/ 下，答题端在站点根路径，故指向站点根。 */}
          <a className="top-link" href={STUDENT_APP_URL}>
            答题端
          </a>
          <IconButton
            label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            onClick={toggleTheme}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </IconButton>
          <IconButton
            label="退出登录"
            onClick={() => {
              signOut();
              navigate("/login");
            }}
          >
            <Icon name="logout" />
          </IconButton>
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">
              {(authUser?.name ?? "管").slice(0, 1)}
            </span>
            <span className="user-chip-text">
              <span className="user-chip-name">{authUser?.name ?? "管理员"}</span>
              <span className="user-chip-meta">{roleLabel}</span>
            </span>
          </div>
        </header>

        <div className="app-body">
          <nav
            className={navOpen ? "sidebar is-open" : "sidebar"}
            aria-label="主导航"
            onClick={() => setNavOpen(false)}
          >
            {ADMIN_NAV.map((group) => (
              <div className="nav-group" key={group.group}>
                <div className="nav-group-title">{group.group}</div>
                {group.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className="nav-item"
                    aria-current={isActive(item.path) ? "page" : undefined}
                  >
                    <Icon name={item.icon} />
                    <span className="nav-label">{item.label}</span>
                    {navCounts[item.path] ? (
                      <span className="nav-count num">{navCounts[item.path]}</span>
                    ) : null}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <main className="view" id="view" tabIndex={-1}>
            <div className="view-inner">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
