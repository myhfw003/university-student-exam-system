/* ==========================================================================
   知行测评 · 管理端导航
   分组与文案对齐原型 docs/ui-design/admin/js/admin-config.js 的 nav 配置，
   并按 docs/design/06-frontend.md §8.2 补充「系统」分组。

   「考试场次」与「实时监考」是 React 独有的路由（原型没有这两个模块），
   原型侧栏因此只有 8 个入口。这两条若不接进侧栏，这两个功能在界面上
   没有任何入口、只能手输 URL，所以并进「测评」组末尾——原型那三条的
   相对顺序不变。
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
      { path: "/review", label: "阅卷中心", icon: "edit" },
      { path: "/analytics", label: "成绩分析", icon: "chart" },
      // React 独有的两条：接进侧栏，场次与监考才不用手输 URL。
      { path: "/exam-sessions", label: "考试场次", icon: "clipboard" },
      { path: "/monitoring", label: "实时监考", icon: "eye" },
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
