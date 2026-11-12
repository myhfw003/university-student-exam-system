import type { ComponentType } from "react";
/* ==========================================================================
   知行测评 · 学生端路由
   路径对齐 docs/design/06-frontend.md §8.1。
   每个 feature 目录 React.lazy 懒加载，保证首屏体积可控（§10）。
   ========================================================================== */

import { lazy, Suspense } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppProviders } from "./app/providers";
import { AppLayout } from "./app/AppLayout";
import { RequireAuth } from "./app/guards";

const NotFoundPage = lazy(async () => ({
  default: (await import("./features/errors")).NotFoundPage,
}));
const ForbiddenPage = lazy(async () => ({
  default: (await import("./features/errors")).ForbiddenPage,
}));
const LoginPage = lazy(async () => ({
  default: (await import("./features/auth/LoginPage")).LoginPage,
}));
const DashboardPage = lazy(async () => ({
  default: (await import("./features/pages")).DashboardPage,
}));
const PracticeListPage = lazy(async () => ({
  default: (await import("./features/pages")).PracticeListPage,
}));
const PracticeSessionPage = lazy(async () => ({
  default: (await import("./features/pages")).PracticeSessionPage,
}));
const ExamListPage = lazy(async () => ({
  default: (await import("./features/pages")).ExamListPage,
}));
const ExamSessionPage = lazy(async () => ({
  default: (await import("./features/pages")).ExamSessionPage,
}));
const ExamReportPage = lazy(async () => ({
  default: (await import("./features/pages")).ExamReportPage,
}));
const ReportListPage = lazy(async () => ({
  default: (await import("./features/pages")).ReportListPage,
}));
const MistakesPage = lazy(async () => ({
  default: (await import("./features/pages")).MistakesPage,
}));
const ProfilePage = lazy(async () => ({
  default: (await import("./features/pages")).ProfilePage,
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
    // 登录守卫：未登录时跳转 /login 并携带原路由
    element: <RequireAuth />,
    children: [
      {
        // 应用外壳：顶栏 + 侧栏 + 视图容器
        element: <AppLayout />,
        children: [
          { index: true, element: lazyPage(DashboardPage) },
          { path: "practice", element: lazyPage(PracticeListPage) },
          { path: "practice/:assignmentId", element: lazyPage(PracticeSessionPage) },
          { path: "exams", element: lazyPage(ExamListPage) },
          { path: "exams/:sessionId", element: lazyPage(ExamSessionPage) },
          { path: "exams/:sessionId/report", element: lazyPage(ExamReportPage) },
          { path: "reports", element: lazyPage(ReportListPage) },
          { path: "mistakes", element: lazyPage(MistakesPage) },
          { path: "profile", element: lazyPage(ProfilePage) },
          { path: "403", element: lazyPage(ForbiddenPage) },
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
