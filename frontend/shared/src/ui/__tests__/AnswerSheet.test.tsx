import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnswerSheet, type SheetCell } from "../AnswerSheet";

const cells: SheetCell[] = [
  { slot: 1, qid: "q-1", answered: true },
  { slot: 2, qid: "q-2", answered: false, marked: true },
  { slot: 3, qid: "q-3", answered: false },
];

describe("AnswerSheet · 答题卡", () => {
  it("渲染题号并标注已作答状态", () => {
    const { container } = render(
      <AnswerSheet cells={cells} currentSlot={1} onSelect={() => {}} />,
    );

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(container.querySelectorAll(".sheet-cell.is-answered")).toHaveLength(1);
    expect(container.querySelectorAll(".sheet-cell.is-current")).toHaveLength(1);
  });

  it("已标记的格子带标记点与无障碍说明", () => {
    const { container } = render(
      <AnswerSheet cells={cells} currentSlot={1} onSelect={() => {}} />,
    );

    expect(container.querySelectorAll(".sheet-flag")).toHaveLength(1);
    expect(screen.getByLabelText("第 2 题（未作答）（已标记）")).toBeInTheDocument();
    expect(screen.getByLabelText("第 1 题（已作答）")).toBeInTheDocument();
  });

  it("点击格子回调该题", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<AnswerSheet cells={cells} currentSlot={1} onSelect={onSelect} />);

    await user.click(screen.getByText("3"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ qid: "q-3", slot: 3 }));
  });

  it("提供图例说明各状态", () => {
    render(<AnswerSheet cells={cells} currentSlot={1} onSelect={() => {}} />);
    expect(screen.getByText("已作答")).toBeInTheDocument();
    expect(screen.getByText("未作答")).toBeInTheDocument();
    expect(screen.getByText("当前题")).toBeInTheDocument();
    expect(screen.getByText("已标记")).toBeInTheDocument();
  });
});
