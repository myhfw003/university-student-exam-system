import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchInput } from "../SearchInput";

describe("SearchInput", () => {
  it("输入后不立即触发 onSearch（防抖 180ms）", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<SearchInput onSearch={onSearch} />);

    await user.type(screen.getByLabelText("搜索"), "微积分");
    expect(onSearch).not.toHaveBeenCalled();

    await waitFor(() => expect(onSearch).toHaveBeenCalledWith("微积分"));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("防抖回调触发后把焦点收回输入框，光标置于末尾", async () => {
    const user = userEvent.setup();
    render(<SearchInput onSearch={() => {}} />);
    const input = screen.getByLabelText("搜索") as HTMLInputElement;

    await user.type(input, "abc");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("连续输入只触发一次 onSearch（防抖合并）", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<SearchInput onSearch={onSearch} />);

    await user.type(screen.getByLabelText("搜索"), "abc");
    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    expect(onSearch).toHaveBeenCalledWith("abc");
  });
});
