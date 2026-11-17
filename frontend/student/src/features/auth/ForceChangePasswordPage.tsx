/* ==========================================================================
   知行测评 · 学生端强制改密
   --------------------------------------------------------------------------
   管理员重置密码或导入名单后，用户必须先改密才能用系统。
   路由守卫会把这类用户统一送到本页；改密成功后回到原来要去的页面。
   ========================================================================== */

import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Callout, Card, ChangePasswordForm, toast, useAuth } from "@exam/shared";

/** 强制改密页。 */
export function ForceChangePasswordPage() {
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);
  const changePassword = useAuth((state) => state.changePassword);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const handleSubmit = async (
    current: string,
    next: string,
  ): Promise<string | null> => {
    const result = await changePassword(current, next);
    if (!result.ok) {
      return result.message ?? "修改失败，请重试";
    }
    toast.ok("密码已修改");
    navigate(from ?? "/", { replace: true });
    return null;
  };

  return (
    <div className="view-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">请先修改密码</h1>
          <p className="page-sub">
            管理员已重置你的初始密码。为保障账号安全，修改密码后才能继续使用。
          </p>
        </div>
      </div>
      <div className="split">
        <div className="stack">
          <Card title="修改密码">
            <ChangePasswordForm onSubmit={handleSubmit} submitText="修改密码并继续" />
          </Card>
        </div>
        <div className="stack">
          <Callout tone="info" title="改密之后">
            <ul className="plain-list">
              <li>当前账号：{user?.account ?? "—"}</li>
              <li>新密码至少 8 位，且不能与原密码相同。</li>
              <li>改密后其它设备上的登录会立即失效。</li>
            </ul>
          </Callout>
        </div>
      </div>
    </div>
  );
}
