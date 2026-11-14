/* ==========================================================================
   知行测评 · 管理端 Providers
   QueryClient（TanStack Query）+ 主题初始化。
   ========================================================================== */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, useAuth } from "@exam/shared";
import { isBackendEnabled, loadCatalogSnapshot } from "@exam/shared/api";
import { applyRemoteSnapshot } from "@exam/shared/mock/catalog";
import { useAdminOps } from "@exam/shared/mock/adminOps";
import { initTheme } from "./themeStore";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 管理端统计分析缓存 1 分钟（docs/design/06-frontend.md §10）
        staleTime: 60 * 1000,
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

  // 登录态：mock 模式用演示管理员自动登录，http 模式拉 /auth/me。
  const users = useAdminOps((state) => state.users);
  const bootstrap = useAuth((state) => state.bootstrap);
  const demo = useMemo(() => {
    const admin = users.find((u) => u.account === "admin");
    if (!admin) return null;
    return {
      id: admin.id,
      account: admin.account,
      name: admin.name,
      roles: admin.roles,
      orgTags: admin.orgTags,
    };
  }, [users]);

  useEffect(() => {
    initTheme();
  }, []);

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
