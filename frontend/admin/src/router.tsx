import type { ComponentType } from "react";
/* ==========================================================================
   知行测评 · 管理端路由
   路径对齐 docs/design/06-frontend.md §8.2。
   每个 feature 目录 React.lazy 懒加载（§8.3）。
   ========================================================================== */

import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { AppProviders } from "./app/providers";
import { AppLayout } from "./app/AppLayout";
import { RequirePermission } from "./app/guards";

const NotFoundPage = lazy(async () => ({
  default: (await import("./features/errors")).NotFoundPage,
}));
const ForbiddenPage = lazy(async () => ({
  default: (await import("./features/errors")).ForbiddenPage,
}));
const LoginPage = lazy(async () => ({
  default: (await import("./features/auth/LoginPage")).LoginPage,
}));
const OverviewPage = lazy(async () => ({
  default: (await import("./features/overview/OverviewPage")).OverviewPage,
}));
const TagsPage = lazy(async () => ({
  default: (await import("./features/tags/TagsPage")).TagsPage,
}));
const BanksPage = lazy(async () => ({
  default: (await import("./features/banks/BanksPage")).BanksPage,
}));
const BankWorkbenchPage = lazy(async () => ({
  default: (await import("./features/banks/BankWorkbenchPage")).BankWorkbenchPage,
}));
const PaperListPage = lazy(async () => ({
  default: (await import("./features/papers/PaperListPage")).PaperListPage,
}));
const PaperWizardPage = lazy(async () => ({
  default: (await import("./features/papers/PaperWizardPage")).PaperWizardPage,
}));
const ExamSessionListPage = lazy(async () => ({
  default: (await import("./features/sessions/ExamSessionListPage")).ExamSessionListPage,
}));
const ExamSessionDetailPage = lazy(async () => ({
  default: (await import("./features/sessions/ExamSessionDetailPage")).ExamSessionDetailPage,
}));
const ProctoringPage = lazy(async () => ({
  default: (await import("./features/monitoring/ProctoringPage")).ProctoringPage,
}));
const ReviewCenterPage = lazy(async () => ({
  default: (await import("./features/review/ReviewCenterPage")).ReviewCenterPage,
}));
const AnalyticsPage = lazy(async () => ({
  default: (await import("./features/analytics/AnalyticsPage")).AnalyticsPage,
}));
const UsersPage = lazy(async () => ({
  default: (await import("./features/users/UsersPage")).UsersPage,
}));
const AuditLogPage = lazy(async () => ({
  default: (await import("./features/audit/AuditLogPage")).AuditLogPage,
}));

function Fallback() {
  return (
    <div className="view-inner">
      <p className="text-3 text-sm">加载中…</p>
    </div>
  );
}

function lazyPage(Component: ComponentType) {
  return (
    <Suspense fallback={<Fallback />}>
      <Component />
    </Suspense>
  );
}

const router = createBrowserRouter([
  {
    path: "/login",
    element: lazyPage(LoginPage),
  },
  {
    // 权限守卫：按权限点判定，无权限跳转 403 页
    element: <RequirePermission />,
    children: [
      {
        // 应用外壳：顶栏 + 侧栏 + 视图容器
        element: <AppLayout />,
        children: [
          { path: "/", element: <Navigate to="/overview" replace /> },
          { path: "/overview", element: lazyPage(OverviewPage) },
          { path: "/tags", element: lazyPage(TagsPage) },
          { path: "/banks", element: lazyPage(BanksPage) },
          { path: "/banks/:bankId", element: lazyPage(BankWorkbenchPage) },
          { path: "/papers", element: lazyPage(PaperListPage) },
          { path: "/papers/:paperId", element: lazyPage(PaperWizardPage) },
          { path: "/exam-sessions", element: lazyPage(ExamSessionListPage) },
          { path: "/exam-sessions/:id", element: lazyPage(ExamSessionDetailPage) },
          { path: "/monitoring/:sessionId", element: lazyPage(ProctoringPage) },
          { path: "/review", element: lazyPage(ReviewCenterPage) },
          { path: "/analytics", element: lazyPage(AnalyticsPage) },
          { path: "/users", element: lazyPage(UsersPage) },
          { path: "/audit-logs", element: lazyPage(AuditLogPage) },
          { path: "/403", element: lazyPage(ForbiddenPage) },
          { path: "*", element: lazyPage(NotFoundPage) },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
