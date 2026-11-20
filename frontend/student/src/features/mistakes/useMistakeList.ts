/* ==========================================================================
   知行测评 · 错题本列表
   --------------------------------------------------------------------------
   两条数据通路各一份实现，页面只认 `MistakeListRow`：

   - mock 模式：本地内容仓库里的错题；
   - HTTP 模式：`GET /mistakes`（服务端已按当前答题者过滤）。

   单题重做：mock 模式跳伪练习路由，HTTP 模式先让服务端把单题练习与
   作答会话开好（`POST /mistakes/{questionId}/redo`），再跳练习页。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isBackendEnabled, loadMistakes, redoMistake } from "@exam/shared/api";
import type { MistakeFilter } from "@exam/shared/api";
import type { QuestionType } from "@exam/shared/domain/types";
import { matchTagFilter, useCatalog } from "@exam/shared/mock/catalog";
import { useStudentMistakes } from "@/features/shared/studentData";

/** 错题本的一行。 */
export interface MistakeListRow {
  /** 题目 ID。 */
  questionId: string;
  type: QuestionType;
  typeLabel: string;
  /** 题干。 */
  stem: string;
  /** 标签 ID。 */
  tags: string[];
  /** 错因。 */
  reason: string;
  /** 错了几次。 */
  wrongCount: number;
  /** 最近一次做错的时间。 */
  lastWrongAt: string;
}

/**
 * mock 侧的筛选：与服务端 `GET /mistakes` 同一套口径。
 *
 * - 标签：服务端把选中标签的子标签也算进来，这里用 `matchTagFilter` 对齐；
 * - 题型：直接比题目的题型；
 * - 时间范围：比最近一次做错的时间。
 */
function matchesMistakeFilter(
  question: { type: QuestionType; tags: string[] },
  mistake: { lastWrongAt: string },
  filter: MistakeFilter,
): boolean {
  if (
    filter.tagId &&
    !matchTagFilter(question, [filter.tagId], { includeDescendants: true, matchMode: "any" })
  ) {
    return false;
  }

  if (filter.questionType && question.type !== filter.questionType) {
    return false;
  }

  const wrongAt = new Date(mistake.lastWrongAt).getTime();
  if (filter.from && wrongAt < new Date(filter.from).getTime()) return false;
  if (filter.to && wrongAt > new Date(filter.to).getTime()) return false;

  return true;
}

/** mock 模式的错题本。 */
export function useLocalMistakeList(
  enabled: boolean,
  filter: MistakeFilter,
): MistakeListRow[] {
  const mistakes = useStudentMistakes();
  const questions = useCatalog((state) => state.questions);

  return useMemo(() => {
    if (!enabled) return [];
    const rows: MistakeListRow[] = [];
    for (const mistake of mistakes) {
      const question = questions.find((q) => q.id === mistake.qid);
      if (!question) continue;
      if (!matchesMistakeFilter(question, mistake, filter)) continue;
      rows.push({
        questionId: question.id,
        type: question.type,
        typeLabel: question.type,
        stem: question.stem,
        tags: question.tags,
        reason: mistake.reason,
        wrongCount: mistake.wrongCount,
        lastWrongAt: mistake.lastWrongAt,
      });
    }
    return rows;
  }, [mistakes, questions, enabled, filter]);
}

/** HTTP 模式的错题本。 */
export function useRemoteMistakeList(
  enabled: boolean,
  filter: MistakeFilter,
): {
  rows: MistakeListRow[];
  loading: boolean;
} {
  const [rows, setRows] = useState<MistakeListRow[]>([]);
  const [loading, setLoading] = useState(false);
  // 标签表：接口给的是标签名，这里换成前端的标签 ID。
  const tags = useCatalog((state) => state.tags);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const mistakes = await loadMistakes(filter);
        if (cancelled) return;
        setRows(
          mistakes.map((mistake) => ({
            questionId: mistake.questionId,
            type: mistake.type,
            typeLabel: mistake.typeLabel,
            stem: mistake.stem,
            tags: mistake.tagNames
              .map((name) => tags.find((tag) => tag.name === name)?.id)
              .filter((id): id is string => Boolean(id)),
            reason: mistake.reasonLabel || mistake.reason,
            wrongCount: mistake.wrongCount,
            lastWrongAt: mistake.lastWrongAt,
          })),
        );
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, tags, filter]);

  return { rows, loading };
}

/**
 * 单题重做。
 *
 * mock 模式跳伪练习路由；HTTP 模式让服务端开好单题练习与会话再跳。
 */
export function useRedoMistake(): (questionId: string) => void {
  const navigate = useNavigate();
  const remote = isBackendEnabled();

  return useCallback(
    (questionId: string) => {
      if (!remote) {
        navigate(`/practice/single-${questionId}`);
        return;
      }

      void redoMistake(questionId)
        .then((redo) => navigate(`/practice/${redo.practiceAssignmentId}`))
        .catch(() => {
          // 重做开不起来时留在错题本页，不打断浏览。
        });
    },
    [remote, navigate],
  );
}

/** 错题本（按数据源分派）。 */
export function useMistakeList(filter: MistakeFilter): {
  rows: MistakeListRow[];
  loading: boolean;
} {
  const remote = isBackendEnabled();
  const local = useLocalMistakeList(!remote, filter);
  const remoteList = useRemoteMistakeList(remote, filter);
  return remote ? remoteList : { rows: local, loading: false };
}
