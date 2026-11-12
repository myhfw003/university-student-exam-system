import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "../LoginPage";

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  it("渲染账号与密码输入框", () => {
    renderLogin();
    expect(screen.getByLabelText("账号")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
  });

  it("空提交时显示校验错误并关联到字段", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: "登录" }));

    const account = await screen.findByLabelText("账号");
    expect(account).toHaveAttribute("aria-invalid", "true");
    expect(account).toHaveAccessibleDescription("请输入账号");
    expect(screen.getByLabelText("密码")).toHaveAttribute("aria-invalid", "true");
  });

  it("填写后错误消失，aria-invalid 被移除", async () => {
    const user = userEvent.setup();
    renderLogin();
    const account = screen.getByLabelText("账号");
    await user.type(account, "2023120101");
    await user.type(screen.getByLabelText("密码"), "secret");
    expect(account).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("请输入账号")).not.toBeInTheDocument();
  });
});
