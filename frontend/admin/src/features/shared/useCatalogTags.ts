/* ==========================================================================
   知行测评 · 管理端标签目录
   --------------------------------------------------------------------------
   题目编辑器、题目列表都要「标签 ID → 名称 / 维度」的对照表：
   mock 模式读本地目录，HTTP 模式读服务端。

   HTTP 模式为什么不能沿用本地目录：真实后端的标签 ID 是数字主键，
   本地目录里是 `t-df1` 这样的假 ID——发到服务端会被判成「存在未知标签」。
   另外组织维度的标签只挂用户、挂不到题目上，服务端已经过滤掉了。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import { isBackendEnabled, loadQuestionTags, type QuestionTag } from "@exam/shared/api";
import { TAG_GROUP_LABEL, useCatalog } from "@exam/shared/mock/catalog";

export type { QuestionTag };

/** 标签目录。 */
export function useCatalogTags(): {
  tags: QuestionTag[];
  loading: boolean;
  refresh: () => void;
} {
  const remote = isBackendEnabled();
  const mockTags = useCatalog((state) => state.tags);

  const [remoteTags, setRemoteTags] = useState<QuestionTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const tags = await loadQuestionTags();
        if (!cancelled) setRemoteTags(tags);
      } catch {
        if (!cancelled) setRemoteTags([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, token]);

  const mockRows = useMemo<QuestionTag[]>(
    () =>
      mockTags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        group: tag.group,
        groupLabel: TAG_GROUP_LABEL[tag.group] ?? tag.group,
        level: tag.level ?? null,
      })),
    [mockTags],
  );

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  return { tags: remote ? remoteTags : mockRows, loading, refresh };
}
