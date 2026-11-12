import type { CSSProperties } from "react";
/* ==========================================================================
   知行测评 · 学生端登录
   真实表单：账号 + 密码，react-hook-form + zod 校验。
   后端未就绪，提交时提示「尚未接入后端」而不发起真实请求。
   ========================================================================== */

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button, Callout } from "@exam/shared";

const loginSchema = z.object({
  account: z.string().min(1, "请输入账号"),
  password: z.string().min(1, "请输入密码"),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { account: "", password: "" },
  });

  const onSubmit = async (_values: LoginValues) => {
    // 骨架：接入 POST /auth/login 后在此换发令牌并跳转
    await new Promise((resolve) => setTimeout(resolve, 300));
    navigate("/", { replace: true });
  };

  return (
    <div className="login-page">
      <section className="login-card card">
        <div className="card-head">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg
                className="od-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ "--od-icon-size": "17px" } as CSSProperties}
              >
                <path d="M6.5 12.4l3.6 3.6L17.8 8.4" />
              </svg>
            </span>
            <span className="brand-text">
              <span className="brand-name">知行测评</span>
              <span className="brand-sub">在线考试与练习平台</span>
            </span>
          </div>
        </div>
        <div className="card-body stack">
          <Callout tone="info" title="尚未接入后端">
            当前为前端骨架：表单校验已可用，提交后不会真正登录。
          </Callout>

          <form
            className="stack"
            noValidate
            onSubmit={(event) => {
              void handleSubmit(onSubmit)(event);
            }}
          >
            <div className="field">
              <label className="field-label" htmlFor="login-account">
                账号
              </label>
              <input
                id="login-account"
                className={errors.account ? "input is-invalid" : "input"}
                type="text"
                autoComplete="username"
                aria-invalid={errors.account ? true : undefined}
                aria-describedby={errors.account ? "login-account-error" : undefined}
                placeholder="请输入学号或工号"
                {...register("account")}
              />
              {errors.account ? (
                <span className="field-error" id="login-account-error">
                  {errors.account.message}
                </span>
              ) : null}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="login-password">
                密码
              </label>
              <input
                id="login-password"
                className={errors.password ? "input is-invalid" : "input"}
                type="password"
                autoComplete="current-password"
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={errors.password ? "login-password-error" : undefined}
                placeholder="请输入密码"
                {...register("password")}
              />
              {errors.password ? (
                <span className="field-error" id="login-password-error">
                  {errors.password.message}
                </span>
              ) : null}
            </div>

            <Button type="submit" variant="primary" loading={isSubmitting}>
              登录
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
