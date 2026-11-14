/* ==========================================================================
   知行测评 · 数据源开关
   --------------------------------------------------------------------------
   前端有两条数据通路：

   - **mock**（缺省）：内容数据来自 `shared/src/mock/` 的本地示例数据，
     后端未就绪时也能完整跑通所有流程。
   - **http**：内容数据来自 `/api/v1/**`，登录态、服务端时钟、答案上行、
     监考快照都走后端。

   切换方式（构建期环境变量）：

   - `VITE_DATA_SOURCE=http` 显式切到后端；
   - 或设置 `VITE_API_BASE_URL`（如 `https://api.example.edu/api/v1`）时自动切到后端。

   **页面代码不感知这个开关**：所有「读 mock 还是读后端」的判断都收敛在这里，
   以及各数据通路的适配层（transport / proctor feed / catalog loader）。
   ========================================================================== */

/** 数据源模式。 */
export type DataSourceMode = "mock" | "http";

/** 读取环境变量（共享层以源码方式被两个 SPA 消费，需容错）。 */
function envValue(key: string): string | undefined {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.[key];
  } catch {
    return undefined;
  }
}

/** 当前数据源模式。 */
export function dataSourceMode(): DataSourceMode {
  const explicit = envValue("VITE_DATA_SOURCE");
  if (explicit === "http") return "http";
  if (explicit === "mock") return "mock";
  return envValue("VITE_API_BASE_URL") ? "http" : "mock";
}

/** 是否走真实后端。 */
export function isBackendEnabled(): boolean {
  return dataSourceMode() === "http";
}

/** 后端基地址：未配置时用相对路径 `/api/v1`（同源部署，由 nginx 反代）。 */
export function apiBaseUrl(): string {
  return envValue("VITE_API_BASE_URL") ?? "/api/v1";
}
