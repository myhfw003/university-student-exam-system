/* ==========================================================================
   考试列表的操作按钮与表头
   --------------------------------------------------------------------------
   1. 已结束且**不可重考**的考试只给「回顾试卷」，不给「进入考试」
      （原型 student.js:988）；不可重考的入口会落到「考试已结束」空态。
   2. 操作列表头是空的（原型 <th></th>），用 aria-label 保住无障碍名称。
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ExamListPage } from "../ExamListPage";
import { useStudentStore } from "@/stores/studentStore";

/** 渲染考试列表。 */
function renderList() {
  return render(
    <MemoryRouter initialEntries={["/exams"]}>
      <ExamListPage />
    </MemoryRouter>,
  );
}

describe("ExamListPage · 考试列表", () => {
  beforeEach(() => {
    useStudentStore.getState().setStudentId("2023120101");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
  });

  it("已结束且不可重考的考试只给「回顾试卷」，不给「进入考试」", async () => {
    renderList();

    // 高等数学期末考试：已结束、allowRetake = false。
    await waitFor(() => {
      expect(screen.getByText("高等数学期末考试")).toBeInTheDocument();
    });

    const row = screen.getByText("高等数学期末考试").closest("tr")!;
    expect(row.textContent).toContain("回顾试卷");
    expect(row.textContent).not.toContain("进入考试");
  });

  it("已结束但可重考的考试给「进入考试」补考入口", async () => {
    renderList();

    // 数据结构随堂测验：已结束、allowRetake = true。
    await waitFor(() => {
      expect(screen.getByText("数据结构随堂测验")).toBeInTheDocument();
    });

    const row = screen.getByText("数据结构随堂测验").closest("tr")!;
    expect(row.textContent).toContain("进入考试");
    expect(row.textContent).toContain("回顾试卷");
  });

  it("操作列表头无可见文案，但保留无障碍名称", async () => {
    const { container } = renderList();
    await waitFor(() => {
      expect(container.querySelector("table")).toBeInTheDocument();
    });

    const actionHeader = container.querySelector('th[aria-label="操作"]');
    expect(actionHeader).not.toBeNull();
    expect(actionHeader?.textContent).toBe("");
  });
});
