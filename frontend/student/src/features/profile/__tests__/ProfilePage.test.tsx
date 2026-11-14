/* ==========================================================================
   学生端个人中心
   --------------------------------------------------------------------------
   「清除本地数据」的确认文案逐字照抄原型（student.js:1904）。
   ========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ProfilePage } from "../ProfilePage";
import { useStudentStore } from "@/stores/studentStore";
import { resetCatalog } from "@exam/shared/mock/catalog";

beforeEach(() => {
  resetCatalog();
  useStudentStore.getState().setStudentId("2023120101");
});

describe("ProfilePage · 个人中心", () => {
  it("清除本地数据的确认文案与原型一致", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "清除本地数据" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "将清除本机保存的全部作答记录、练习结果与阅卷进度，并恢复为初始示例数据。此操作不可撤销。",
    );
  });
});
