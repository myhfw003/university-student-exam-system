/* ==========================================================================
   学生端成绩归档
   --------------------------------------------------------------------------
   mock catalog 是纯内存的，刷新后 attempts / practiceResults 会丢，
   成绩列表随之清空。这里验证归档的落盘与回灌。
   ========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";
import {
  hydrateCatalogFromArchive,
  startResultArchive,
  useResultArchive,
} from "../resultArchive";
import { resetCatalog, savePracticeResult, useCatalog } from "@exam/shared/mock/catalog";

const KEY = "prac-ds-linear:2023120101";

/** 一条练习成绩。 */
function practiceResult(score: number) {
  return {
    practiceId: "prac-ds-linear",
    studentId: "2023120101",
    score,
    total: 100,
    attempts: 1,
    submittedAt: "2026-11-09T10:24:00.000Z",
  };
}

beforeEach(() => {
  resetCatalog();
  useResultArchive.setState({ attempts: {}, practiceResults: {}, mistakes: [] });
});

describe("resultArchive · 成绩归档", () => {
  it("回灌后 catalog 里能看到归档的练习成绩与错题", () => {
    useResultArchive.setState({
      practiceResults: { [KEY]: practiceResult(88) },
      mistakes: [
        {
          qid: "q-m-05",
          studentId: "2023120101",
          wrongCount: 4,
          lastWrongAt: "2026-11-09",
          reason: "多选题漏选或错选",
        },
      ],
    });

    hydrateCatalogFromArchive();

    expect(useCatalog.getState().practiceResults[KEY]?.score).toBe(88);
    // 归档里的错题比种子新（种子是 3 次），取归档的。
    expect(
      useCatalog.getState().mistakes.find((m) => m.qid === "q-m-05")?.wrongCount,
    ).toBe(4);
  });

  it("catalog 里已有的记录不被归档覆盖", () => {
    // 本次会话刚产生的成绩优先于归档。
    savePracticeResult(practiceResult(60));
    useResultArchive.setState({ practiceResults: { [KEY]: practiceResult(88) } });

    hydrateCatalogFromArchive();

    expect(useCatalog.getState().practiceResults[KEY]?.score).toBe(60);
  });

  it("catalog 变化后写回归档", () => {
    const stop = startResultArchive();

    savePracticeResult(practiceResult(95));

    expect(useResultArchive.getState().practiceResults[KEY]?.score).toBe(95);
    stop();
  });
});
