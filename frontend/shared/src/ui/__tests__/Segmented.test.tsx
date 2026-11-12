import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Segmented } from "../Segmented";

const options = [
  { value: "all", label: "全部" },
  { value: "ok", label: "已完成" },
  { value: "todo", label: "待办" },
];

describe("Segmented", () => {
  it("外层使用 role=group 并带无障碍名称", () => {
    render(<Segmented options={options} value="all" onChange={() => {}} label="状态筛选" />);
    const group = screen.getByRole("group", { name: "状态筛选" });
    expect(group).toBeInTheDocument();
  });

  it("当前选中项的 aria-pressed 为 true，其余为 false", () => {
    render(<Segmented options={options} value="ok" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "已完成" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "待办" })).toHaveAttribute("aria-pressed", "false");
  });

  it("点击选项触发 onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Segmented options={options} value="all" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "待办" }));
    expect(onChange).toHaveBeenCalledWith("todo");
  });
});
