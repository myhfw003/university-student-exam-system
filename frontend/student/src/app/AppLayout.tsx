/* ==========================================================================
   知行测评 · 学生端应用外壳
   顶栏 + 侧栏 + 视图容器。类名沿用原型 .app / .topbar / .sidebar / .view。
   ========================================================================== */

import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { IconButton } from "@exam/shared";
import { Icon } from "./Icon";
import { STUDENT_NAV } from "./nav";
import { useThemeStore } from "./themeStore";

/** 当前学生身份（骨架，接后端后从 /auth/me 获取）。 */
const CURRENT_USER = {
  name: "林知远",
  meta: "2023120101 · 计算机科学 2023 级 1 班",
  initial: "林",
};

export function AppLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const location = useLocation();

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
              <span className="brand-sub">在线考试与练习平台</span>
            </span>
          </div>
          <div className="topbar-spacer" />
          <IconButton
            label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            onClick={toggleTheme}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </IconButton>
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">
              {CURRENT_USER.initial}
            </span>
            <span className="user-chip-text">
              <span className="user-chip-name">{CURRENT_USER.name}</span>
              <span className="user-chip-meta">{CURRENT_USER.meta}</span>
            </span>
          </div>
        </header>

        <div className="app-body">
          <nav
            className={navOpen ? "sidebar is-open" : "sidebar"}
            aria-label="主导航"
            onClick={() => setNavOpen(false)}
          >
            {STUDENT_NAV.map((group) => (
              <div className="nav-group" key={group.group}>
                <div className="nav-group-title">{group.group}</div>
                {group.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/"}
                    className="nav-item"
                    aria-current={isActive(item.path) ? "page" : undefined}
                  >
                    <Icon name={item.icon} />
                    <span className="nav-label">{item.label}</span>
                    {item.count ? <span className="nav-count num">{item.count}</span> : null}
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
