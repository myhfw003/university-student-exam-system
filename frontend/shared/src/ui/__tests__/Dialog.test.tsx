import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "../Dialog";

describe("Dialog", () => {
  it("打开时渲染标题与内容", () => {
    render(
      <Dialog open onClose={() => {}} title="确认交卷">
        <p>正文</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("确认交卷")).toBeInTheDocument();
    expect(screen.getByText("正文")).toBeInTheDocument();
  });

  it("关闭按钮带 aria-label 并触发 onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="确认交卷">
        <p>正文</p>
      </Dialog>,
    );
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalled();
  });
});
