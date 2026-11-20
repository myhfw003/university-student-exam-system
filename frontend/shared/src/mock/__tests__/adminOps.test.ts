/* ==========================================================================
   mock · 管理端运维数据（练习开放单）
   --------------------------------------------------------------------------
   开放单的状态机与后端 `PracticeAssignment` 一致：
   草稿 → 已上架 → 已下架，已下架与草稿都能重新上架，
   只有已上架的才能下架。报错措辞也一样——
   mock 与 HTTP 模式下管理员看到的提示应当相同。
   ========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";
import {
  archivePracticeAssignment,
  createPracticeAssignment,
  publishPracticeAssignment,
  resetAdminOps,
  updatePracticeAssignment,
  useAdminOps,
} from "../adminOps";

beforeEach(() => {
  resetAdminOps();
});

/** 造一张新开放单。 */
function newAssignment(title = "数据结构 · 树与查找专题") {
  return createPracticeAssignment({
    title,
    paperId: "prac-ds-linear",
    scope: [],
    openAt: null,
    closeAt: null,
  });
}

describe("mock · 练习开放单", () => {
  it("新建出来的是草稿，学生还看不见", () => {
    const result = newAssignment();
    expect(result.ok).toBe(true);
    expect(result.assignment?.status).toBe("draft");

    const stored = useAdminOps.getState().practiceAssignments.find((a) => a.id === result.assignment?.id);
    expect(stored?.status).toBe("draft");
    expect(stored?.publishedAt).toBeNull();
  });

  it("标题为空时拒绝新建", () => {
    const result = createPracticeAssignment({
      title: "  ",
      paperId: "prac-ds-linear",
      scope: [],
      openAt: null,
      closeAt: null,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toBe("练习标题不能为空。");
  });

  it("没挂练习卷时拒绝新建", () => {
    const result = createPracticeAssignment({
      title: "测试",
      paperId: "",
      scope: [],
      openAt: null,
      closeAt: null,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toBe("练习试卷不合法。");
  });

  it("上架一次之后再上架被拒", () => {
    const { assignment } = newAssignment();
    expect(publishPracticeAssignment(assignment!.id).ok).toBe(true);

    const again = publishPracticeAssignment(assignment!.id);
    expect(again.ok).toBe(false);
    expect(again.message).toBe("练习已经上架了。");
  });

  it("只有已上架的才能下架", () => {
    const { assignment } = newAssignment();

    const tooEarly = archivePracticeAssignment(assignment!.id);
    expect(tooEarly.ok).toBe(false);
    expect(tooEarly.message).toBe("只有已上架的练习才能下架。");

    publishPracticeAssignment(assignment!.id);
    const result = archivePracticeAssignment(assignment!.id);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("archived");
  });

  it("下架之后还能重新上架", () => {
    const { assignment } = newAssignment();
    publishPracticeAssignment(assignment!.id);
    archivePracticeAssignment(assignment!.id);

    const again = publishPracticeAssignment(assignment!.id);
    expect(again.ok).toBe(true);
    expect(again.status).toBe("published");
  });

  it("关闭时间不晚于开放时间时拒绝保存", () => {
    const { assignment } = newAssignment();

    const bad = updatePracticeAssignment(assignment!.id, {
      openAt: "2026-11-20 10:00",
      closeAt: "2026-11-20 09:00",
    });
    expect(bad.ok).toBe(false);
    expect(bad.message).toBe("关闭时间必须晚于开放时间。");

    const good = updatePracticeAssignment(assignment!.id, {
      openAt: "2026-11-20 09:00",
      closeAt: "2026-11-20 10:00",
    });
    expect(good.ok).toBe(true);
  });

  it("改设置后开放范围落在开放单上", () => {
    const { assignment } = newAssignment();

    const result = updatePracticeAssignment(assignment!.id, {
      title: "改过的标题",
      scope: ["org-class-cs-2301"],
    });
    expect(result.ok).toBe(true);

    const stored = useAdminOps.getState().practiceAssignments.find((a) => a.id === assignment!.id);
    expect(stored?.title).toBe("改过的标题");
    expect(stored?.scope).toEqual(["org-class-cs-2301"]);
  });
});
