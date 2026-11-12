import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OptionList } from "../OptionList";

const options = [
  { key: "A", text: "甲" },
  { key: "B", text: "乙" },
  { key: "C", text: "丙" },
  { key: "D", text: "丁" },
];

describe("OptionList · 客观题选项", () => {
  it("按显示顺序渲染，显示字母按位置重编号", () => {
    render(
      <OptionList
        options={options}
        displayKeys={["C", "A", "D", "B"]}
        toOriginal={{ A: "C", B: "A", C: "D", D: "B" }}
      />,
    );

    // 显示位置 0 显示的是原题 C 项，位置 1 显示原题 A 项。
    const texts = screen.getAllByText(/甲|乙|丙|丁/);
    expect(texts[0]).toHaveTextContent("丙");
    expect(texts[1]).toHaveTextContent("甲");
    expect(texts[2]).toHaveTextContent("丁");
    expect(texts[3]).toHaveTextContent("乙");
  });

  it("单选时回调传出的是显示字母", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <OptionList
        options={options}
        displayKeys={["C", "A", "D", "B"]}
        toOriginal={{ A: "C", B: "A", C: "D", D: "B" }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByText("甲"));
    // 甲 在显示位置 1，对应显示字母 B。
    expect(onChange).toHaveBeenCalledWith(["B"]);
  });

  it("多选时切换选中并按字母排序", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <OptionList
        options={options}
        displayKeys={["C", "A", "D", "B"]}
        toOriginal={{ A: "C", B: "A", C: "D", D: "B" }}
        multiple
        selected={["B"]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByText("丙"));
    // 丙 在显示位置 0（显示字母 A），与已选的 B 合并排序。
    expect(onChange).toHaveBeenCalledWith(["A", "B"]);
  });

  it("只读模式下不响应交互", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <OptionList
        options={options}
        displayKeys={["C", "A", "D", "B"]}
        toOriginal={{ A: "C", B: "A", C: "D", D: "B" }}
        readOnly
        onChange={onChange}
      />,
    );

    await user.click(screen.getByText("甲"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("提供正确答案时高亮正确项（正确答案用原题键）", () => {
    const { container } = render(
      <OptionList
        options={options}
        displayKeys={["C", "A", "D", "B"]}
        toOriginal={{ A: "C", B: "A", C: "D", D: "B" }}
        selected={["A"]}
        correct={["C"]}
      />,
    );

    // 显示字母 A 对应**原题键 C**；correct 传的是原题键，故应判为正确。
    const selected = container.querySelector(".opt.is-selected");
    expect(selected).not.toBeNull();
    expect(selected?.className).toContain("is-correct");
  });

  it("选错项时不高亮为正确", () => {
    const { container } = render(
      <OptionList
        options={options}
        displayKeys={["C", "A", "D", "B"]}
        toOriginal={{ A: "C", B: "A", C: "D", D: "B" }}
        selected={["B"]}
        correct={["C"]}
      />,
    );

    const selected = container.querySelector(".opt.is-selected");
    expect(selected?.className).toContain("is-wrong");
    expect(selected?.className).not.toContain("is-correct");
  });
});
