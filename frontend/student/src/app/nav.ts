/* ==========================================================================
   知行测评 · 学生端导航
   分组与文案对齐原型 docs/ui-design/exam/js/exam-config.js 的 nav 配置。
   ========================================================================== */

export interface NavItem {
  /** 路由路径。 */
  path: string;
  /** 菜单文案。 */
  label: string;
  /** 侧栏图标名（见 Icon.tsx）。 */
  icon: string;
  /** 角标数量（可选）。 */
  count?: number;
}

export interface NavGroup {
  /** 分组标题。 */
  group: string;
  items: NavItem[];
}

/** 侧栏导航：学习 / 记录 两组。 */
export const STUDENT_NAV: NavGroup[] = [
  {
    group: "学习",
    items: [
      { path: "/", label: "工作台", icon: "grid" },
      { path: "/practice", label: "练习中心", icon: "book" },
      { path: "/exams", label: "考试安排", icon: "clipboard" },
      { path: "/mistakes", label: "错题本", icon: "alert", count: 12 },
    ],
  },
  {
    group: "记录",
    items: [
      { path: "/reports", label: "成绩报告", icon: "chart" },
      { path: "/profile", label: "个人中心", icon: "user" },
    ],
  },
];
