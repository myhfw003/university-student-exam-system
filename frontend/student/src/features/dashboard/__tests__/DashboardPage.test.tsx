/* ==========================================================================
   学生端工作台
   --------------------------------------------------------------------------
   覆盖「进行中的考试」卡片：须知里要带整句卷型说明（原型 student.js:449），
   标签片按标签自身分组着色。
   ========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "../DashboardPage";
import { useStudentStore } from "@/stores/studentStore";
import { resetCatalog, useCatalog } from "@exam/shared/mock/catalog";
import { PAPER_MODES } from "@exam/shared/engine/paper";
import { useStudentRecords } from "@/features/shared/studentData";

const STUDENT = "2023120101";

beforeEach(() => {
  resetCatalog();
  useStudentStore.getState().setStudentId(STUDENT);
});

describe("DashboardPage · 工作台", () => {
  it("考试须知里带整句卷型说明", () => {
    const exam = useCatalog.getState().exams.find((e) => e.status === "ongoing");
    expect(exam).toBeTruthy();
    const mode = PAPER_MODES[exam!.plum.mode];

    const { container } = render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    // 原型 student.js:449：{note} 本卷采用{label}（{short}）：{desc}
    expect(container.textContent).toContain("本卷采用");
    expect(container.textContent).toContain(`${mode.label}（${mode.short}）`);
    expect(container.textContent).toContain(mode.desc);
  });

  it("趋势卡的「最近 N 次」按全部记录数算", () => {
    const { result } = renderHook(() => useStudentRecords());

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    // 原型 student.js:399：最近 {records.length} 次（不是折线图的点数）。
    expect(screen.getByText(`最近 ${result.current.length} 次`)).toBeInTheDocument();
  });

  it("错题分布按知识点分组，名字后带分组名", () => {
    const { container } = render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    // 原型 student.js:606：{名称}<span> · {分组}</span>
    expect(container.textContent).toContain("· 知识点");
  });

  it("标签片按标签自身分组着色，不是一律领域色", () => {
    const { container } = render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    // 进行中的试卷挂了知识点标签（t-pt-*），应显示为知识点色。
    expect(container.querySelector(".tag-chip.is-knowledge-point")).not.toBeNull();
    expect(screen.getByText("进行中的考试")).toBeInTheDocument();
  });
});
