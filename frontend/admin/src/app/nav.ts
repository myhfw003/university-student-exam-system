/* ==========================================================================
   知行测评 · 管理端导航
   分组与文案对齐原型 docs/ui-design/admin/js/admin-config.js 的 nav 配置，
   并按 docs/design/06-frontend.md §8.2 补充「系统」分组。
   ========================================================================== */

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  count?: number;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

/** 侧栏导航：内容 / 测评 / 系统 三组。 */
export const ADMIN_NAV: NavGroup[] = [
  {
    group: "内容",
    items: [
      { path: "/overview", label: "概览", icon: "grid" },
      { path: "/tags", label: "标签", icon: "target" },
      { path: "/banks", label: "题库", icon: "library" },
    ],
  },
  {
    group: "测评",
    items: [
      { path: "/papers", label: "组卷", icon: "shuffle" },
      { path: "/review", label: "阅卷中心", icon: "edit", count: 7 },
      { path: "/analytics", label: "成绩分析", icon: "chart" },
    ],
  },
  {
    group: "系统",
    items: [
      { path: "/users", label: "用户", icon: "users" },
      { path: "/audit-logs", label: "审计", icon: "document" },
    ],
  },
];

/** 不在侧栏直接展示、但属于测评域的路由（考试场次与实时监考）。 */
export const ADMIN_SECONDARY_NAV: NavItem[] = [
  { path: "/exam-sessions", label: "考试场次", icon: "clipboard" },
  { path: "/monitoring", label: "实时监考", icon: "eye" },
];
