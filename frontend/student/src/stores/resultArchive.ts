/* ==========================================================================
   知行测评 · 学生端成绩归档（本地持久化）
   --------------------------------------------------------------------------
   原型把整份 store 写进 localStorage（shared/js/app.js:63 store.save），
   刷新后成绩与错题都还在。

   学生端的 mock catalog 是**纯内存**的（shared/src/mock/catalog.ts 只有
   create，没有 persist），刷新后 attempts / practiceResults 会丢：
   - 「/reports」的成绩列表清空；
   - 练习记录的「查看」落到一张空白练习卷，而不是成绩详情。

   这里在学生端补一层归档：
   - 只持久化**本端产生的结果**：作答记录、练习成绩、错题本；
   - 启动时回灌进 mock catalog（catalog 里已有的优先，不覆盖本次会话的结果）；
   - catalog 的这三块变化时写回归档。

   共享层不引入学生端概念，键名也只在学生端使用；
   令牌一律不落盘（见 shared/src/api/tokenStore.ts）。
   ========================================================================== */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Mistake } from "@exam/shared/domain/types";
import {
  useCatalog,
  type ExamAttempt,
  type PracticeResult,
} from "@exam/shared/mock/catalog";

/** 归档的三块结果。 */
export interface ArchivedResults {
  /** 考生作答记录。 */
  attempts: Record<string, ExamAttempt>;
  /** 练习成绩。 */
  practiceResults: Record<string, PracticeResult>;
  /** 错题本。 */
  mistakes: Mistake[];
}

/** 成绩归档状态。 */
export interface ResultArchiveState extends ArchivedResults {
  /** 写入归档。 */
  archive: (results: ArchivedResults) => void;
  /** 清空归档。 */
  clear: () => void;
}

export const useResultArchive = create<ResultArchiveState>()(
  persist(
    (set) => ({
      attempts: {},
      practiceResults: {},
      mistakes: [],
      archive: (results) => set(results),
      clear: () => set({ attempts: {}, practiceResults: {}, mistakes: [] }),
    }),
    {
      name: "zhixing.student.results.v1",
      // 只落盘结果数据，动作函数不落盘。
      partialize: (state) => ({
        attempts: state.attempts,
        practiceResults: state.practiceResults,
        mistakes: state.mistakes,
      }),
    },
  ),
);

/** 错题的去重键。 */
function mistakeKey(mistake: Mistake): string {
  return `${mistake.qid}:${mistake.studentId}`;
}

/**
 * 合并错题：归档里的同名错题覆盖 catalog 的（归档更新），
 * catalog 里其余的错题保留。
 */
function mergeMistakes(
  archived: readonly Mistake[],
  current: readonly Mistake[],
): Mistake[] {
  const merged = [...current];
  for (const mistake of archived) {
    const index = merged.findIndex((m) => mistakeKey(m) === mistakeKey(mistake));
    if (index >= 0) merged[index] = mistake;
    else merged.push(mistake);
  }
  return merged;
}

/**
 * 把归档回灌进 mock catalog。
 *
 * catalog 里已有的记录优先（本次会话刚产生的结果比归档新），
 * 归档只补齐 catalog 缺失的部分。
 */
export function hydrateCatalogFromArchive(): void {
  const archived = useResultArchive.getState();
  const catalog = useCatalog.getState();
  useCatalog.setState({
    attempts: { ...archived.attempts, ...catalog.attempts },
    practiceResults: { ...archived.practiceResults, ...catalog.practiceResults },
    mistakes: mergeMistakes(archived.mistakes, catalog.mistakes),
  });
}

/**
 * 订阅 catalog 的结果切片，写回归档。
 *
 * 返回取消订阅的函数。
 */
export function startResultArchive(): () => void {
  return useCatalog.subscribe((state, prev) => {
    if (
      state.attempts === prev.attempts &&
      state.practiceResults === prev.practiceResults &&
      state.mistakes === prev.mistakes
    ) {
      return;
    }
    useResultArchive.getState().archive({
      attempts: state.attempts,
      practiceResults: state.practiceResults,
      mistakes: state.mistakes,
    });
  });
}
