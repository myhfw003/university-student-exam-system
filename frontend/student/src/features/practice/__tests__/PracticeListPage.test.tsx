/* ==========================================================================
   学生端练习中心
   --------------------------------------------------------------------------
   覆盖练习卡的完成度口径（原型 student.js:659-662）：
   完成度条只有「已做 / 没做」两态，文字是「已完成 N/N 题」（题数，不是分数）。
   ========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PracticeListPage } from "../PracticeListPage";
import { useStudentStore } from "@/stores/studentStore";
import {
  isInScope,
  resetCatalog,
  savePracticeResult,
  useCatalog,
} from "@exam/shared/mock/catalog";
import type { Practice } from "@exam/shared/domain/types";

const STUDENT = "2023120101";

/**
 * 挑一份当前答题者能看见、且还没有成绩的练习。
 *
 * 「有成绩」有两处来源：实时练习成绩（practiceResults）与种子的历史成绩
 * （records）——两份都排掉，才是真的没练过。
 */
function practiceWithoutResult(): Practice {
  const catalog = useCatalog.getState();
  const live = new Set(
    Object.keys(catalog.practiceResults).filter((key) => key.endsWith(`:${STUDENT}`)),
  );
  const history = new Set(
    catalog.records.filter((r) => r.studentId === STUDENT).map((r) => r.examId),
  );
  const found = catalog.practices.find(
    (p) =>
      p.status === "published" &&
      p.published &&
      isInScope(p.scope, STUDENT) &&
      !live.has(`${p.id}:${STUDENT}`) &&
      !history.has(p.id),
  );
  if (!found) throw new Error("没有可用于测试的练习");
  return found;
}

/** 渲染练习中心。 */
function renderList() {
  return render(
    <MemoryRouter>
      <PracticeListPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetCatalog();
  useStudentStore.getState().setStudentId(STUDENT);
});

describe("PracticeListPage · 练习中心", () => {
  it("有成绩时写「已完成 N/N 题」，完成度条满格", () => {
    const practice = practiceWithoutResult();
    const total = practice.questionIds.length;
    savePracticeResult({
      practiceId: practice.id,
      studentId: STUDENT,
      score: 60,
      total: 100,
      attempts: 1,
      submittedAt: "2026-11-09T10:24:00.000Z",
    });

    renderList();

    const card = screen.getByText(practice.name).closest(".card") as HTMLElement;
    // 题数口径：不是「得分 / 满分 题」。
    expect(within(card).getByText(`已完成 ${total}/${total} 题`)).toBeInTheDocument();
    expect((card.querySelector(".meter i") as HTMLElement).style.width).toBe("100%");
  });

  it("没练过时写「尚未开始」，完成度条空着", () => {
    const practice = practiceWithoutResult();

    renderList();

    const card = screen.getByText(practice.name).closest(".card") as HTMLElement;
    expect(within(card).getByText("尚未开始")).toBeInTheDocument();
    expect((card.querySelector(".meter i") as HTMLElement).style.width).toBe("0%");
  });
});
