import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../Button";

describe("Button", () => {
  it("渲染文案并带上原型语义化类名", () => {
    render(<Button variant="primary">保存</Button>);
    const button = screen.getByRole("button", { name: "保存" });
    expect(button).toHaveClass("btn");
    expect(button).toHaveClass("btn-primary");
  });

  it("secondary / danger / ghost 变体映射到对应类名", () => {
    const { rerender } = render(<Button variant="secondary">次要</Button>);
    expect(screen.getByRole("button")).toHaveClass("btn-secondary");

    rerender(<Button variant="danger">危险</Button>);
    expect(screen.getByRole("button")).toHaveClass("btn-danger");

    rerender(<Button variant="ghost">幽灵</Button>);
    expect(screen.getByRole("button")).toHaveClass("btn-ghost");
  });

  it("loading 时禁用按钮并标记 aria-busy", () => {
    render(
      <Button variant="primary" loading loadingText="保存中…">
        保存
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("保存中…");
  });

  it("loading 时展示加载指示器", () => {
    const { container } = render(<Button loading>保存</Button>);
    expect(container.querySelector(".btn-spinner")).not.toBeNull();
  });

  it("点击时触发 onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>提交</Button>);
    await user.click(screen.getByRole("button", { name: "提交" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
