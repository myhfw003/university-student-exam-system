/* ==========================================================================
   知行测评 · 应用 Providers
   QueryClient（TanStack Query）+ 主题初始化。
   ========================================================================== */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, useAuth } from "@exam/shared";
import { isBackendEnabled, loadCatalogSnapshot } from "@exam/shared/api";
import { applyRemoteSnapshot, useCatalog } from "@exam/shared/mock/catalog";
import { useStudentStore } from "@/stores/studentStore";
import { startResultArchive } from "@/stores/resultArchive";
import { initTheme } from "./themeStore";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 学生端成绩报告缓存 5 分钟（docs/design/06-frontend.md §10）
        staleTime: 5 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  const [queryClient] = useState(createQueryClient);

  // 登录态：mock 模式用演示身份自动登录，http 模式拉 /auth/me。
  // 演示身份跟随「当前答题者」，切换答题者即切换登录身份。
  const studentId = useStudentStore((state) => state.studentId);
  const students = useCatalog((state) => state.students);
  const bootstrap = useAuth((state) => state.bootstrap);
  const demo = useMemo(() => {
    const student = students.find((s) => s.id === studentId);
    if (!student) return null;
    return {
      id: student.id,
      account: student.id,
      name: student.name,
      roles: ["student" as const],
      orgTags: [],
    };
  }, [students, studentId]);

  useEffect(() => {
    initTheme();
  }, []);

  // catalog 的成绩结果落盘：刷新后成绩列表与练习结果仍在。
  useEffect(() => startResultArchive(), []);

  useEffect(() => {
    void bootstrap(demo);
  }, [bootstrap, demo]);

  // 数据源切到后端时，读回一次内容目录（页面代码不感知数据源）。
  useEffect(() => {
    if (!isBackendEnabled()) return;
    let cancelled = false;
    void loadCatalogSnapshot()
      .then((snapshot) => {
        if (!cancelled) applyRemoteSnapshot(snapshot);
      })
      .catch(() => {
        // 后端未就绪时保留本地示例数据，页面仍可用。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
