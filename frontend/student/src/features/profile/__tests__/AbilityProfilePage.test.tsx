/* ==========================================================================
   学生端能力画像（mock 模式）
   --------------------------------------------------------------------------
   mock 模式读本地示例仓库。守住三件事：

   1. 每项能力都列出：标签名、掌握度、样本量；
   2. 样本不足的项照样标「样本不足」，并单独统计（不与参与排序的混在一起）；
   3. 画像按答题者隔离——换一个人就是另一个人的画像。
   ========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AbilityProfilePage } from "../AbilityProfilePage";
import { useStudentStore } from "@/stores/studentStore";
import { resetCatalog } from "@exam/shared/mock/catalog";

const STUDENT = "2023120101";

beforeEach(() => {
  resetCatalog();
  useStudentStore.getState().setStudentId(STUDENT);
});

/** 渲染能力画像页。 */
function renderPage() {
  return render(
    <MemoryRouter>
      <AbilityProfilePage />
    </MemoryRouter>,
  );
}

/** 取统计卡上的数值文本（按标签找，避开别处的同名文案）。 */
function statValue(label: string): string {
  const labels = Array.from(document.querySelectorAll(".stat-label"));
  const found = labels.find((node) => node.textContent === label);
  return found?.parentElement?.querySelector(".stat-value")?.textContent ?? "";
}

describe("AbilityProfilePage · 能力画像（mock 模式）", () => {
  it("列出当前答题者的每项能力与掌握度、样本量", () => {
    renderPage();

    // 示例数据里的能力标签（横条与明细表各出现一次）。
    expect(screen.getAllByText("计算求解").length).toBeGreaterThan(0);
    expect(screen.getAllByText("概念理解").length).toBeGreaterThan(0);

    // 掌握度按百分数显示：0.86 → 86%。
    expect(screen.getAllByText("86%").length).toBeGreaterThan(0);
    // 样本量也在。
    expect(screen.getAllByText("样本 12").length).toBeGreaterThan(0);
  });

  it("样本不足的项标「样本不足」，并单独统计", () => {
    renderPage();

    expect(screen.getAllByText("样本不足").length).toBeGreaterThan(0);

    // 统计条：5 项能力，其中 3 项参与排序、2 项样本不足。
    expect(statValue("能力标签")).toContain("5");
    expect(statValue("参与排序")).toContain("3");
    expect(statValue("样本不足")).toContain("2");
  });

  it("换一个答题者就是另一个人的画像（按答题者隔离）", () => {
    useStudentStore.getState().setStudentId("2023120102");
    renderPage();

    expect(screen.getAllByText("计算求解").length).toBeGreaterThan(0);
    // 沈书桐只有两项能力，没有「归纳分析」。
    expect(screen.queryByText("归纳分析")).not.toBeInTheDocument();
    expect(statValue("能力标签")).toContain("2");
  });

  it("没有画像时给空态，而不是白屏", () => {
    useStudentStore.getState().setStudentId("2023120207");
    renderPage();

    expect(screen.getByText("还没有能力画像")).toBeInTheDocument();
    expect(screen.getByText("暂无明细")).toBeInTheDocument();
  });
});
