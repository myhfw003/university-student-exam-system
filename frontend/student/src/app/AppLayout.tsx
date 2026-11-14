/* ==========================================================================
   知行测评 · 学生端应用外壳
   顶栏 + 侧栏 + 视图容器。类名沿用原型 .app / .topbar / .sidebar / .view。
   ========================================================================== */

import { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { IconButton, useAuth } from "@exam/shared";
import { useCatalog } from "@exam/shared/mock/catalog";
import { Icon } from "./Icon";
import { STUDENT_NAV } from "./nav";
import { useStudentStore } from "@/stores/studentStore";
import { useThemeStore } from "./themeStore";

export function AppLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const navigate = useNavigate();
  const signOut = useAuth((state) => state.signOut);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const location = useLocation();

  // 当前身份：接后端后由 /auth/me 覆盖，这里先按「当前答题者 + 其名单组」派生，
  // 不再写死姓名与班级，避免与工作台、成绩页显示的不一致。
  const studentId = useStudentStore((state) => state.studentId);
  const students = useCatalog((state) => state.students);
  const classes = useCatalog((state) => state.classes);
  const mistakes = useCatalog((state) => state.mistakes);
  const student = students.find((s) => s.id === studentId);
  const className = student
    ? classes.find((c) => c.id === student.classId)?.name
    : undefined;

  // 侧栏角标：错题本显示当前答题者的错题数（原型是动态计算的）。
  const mistakeCount = useMemo(
    () => mistakes.filter((m) => !m.studentId || m.studentId === studentId).length,
    [mistakes, studentId],
  );
  const navCounts: Record<string, number> = { "/mistakes": mistakeCount };

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
          {/* 跨端互链：与管理端互相独立（原型 shared/js/app.js 的 .top-link）。 */}
          <a className="top-link" href="/admin/">
            管理端
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
              {(student?.name ?? "考").slice(0, 1)}
            </span>
            <span className="user-chip-text">
              <span className="user-chip-name">{student?.name ?? "考生"}</span>
              <span className="user-chip-meta">
                {student ? `${student.id} · ${className ?? ""}` : ""}
              </span>
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

      {/* 移动端侧栏遮罩：点击即收起导航（原型 shared/js/app.js 的 .scrim）。 */}
      {navOpen ? (
        <div className="scrim" role="presentation" onClick={() => setNavOpen(false)} />
      ) : null}
    </>
  );
}
