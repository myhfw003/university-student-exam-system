/* ==========================================================================
   知行测评 · 错误页（admin）
   独立成模块，避免被静态导入把 pages.tsx 拉进首屏 chunk。
   ========================================================================== */

import { useLocation } from "react-router-dom";
import { Empty } from "@exam/shared";

export function NotFoundPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">页面不存在</h1>
          <p className="page-sub">你访问的页面不存在或已被移除。</p>
        </div>
      </div>
      <Empty title="没有找到这个页面" body="请从左侧导航重新选择要访问的功能。" />
    </>
  );
}

export function ForbiddenPage() {
  const location = useLocation();
  // 守卫跳 403 时带上缺少的权限点（docs/design/06-frontend.md §11）。
  const missing = (location.state as { missing?: string } | null)?.missing;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">无访问权限</h1>
          <p className="page-sub">当前账号缺少访问该页面所需的权限。</p>
        </div>
      </div>
      <Empty
        title="403 · 权限不足"
        body={
          missing
            ? `缺少权限点「${missing}」。如需访问，请联系管理员为账号分配相应权限。`
            : "如需访问，请联系管理员为账号分配相应权限。"
        }
      />
    </>
  );
}
