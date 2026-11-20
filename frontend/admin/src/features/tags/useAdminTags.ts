/* ==========================================================================
   知行测评 · 管理端标签数据通路
   --------------------------------------------------------------------------
   标签管理各有一份 mock / HTTP 实现，页面只认这里定义的形状。

   三处口径差异要注意（页面不知道，数据通路知道）：

   1. **编码**：真实后端新建标签必须给编码（唯一、不可改），mock 没有编码这回事——
      HTTP 模式按「分组 + 名称」派生一个，并允许管理员改。
   2. **难度等级**：真实后端按维度校验（难度维度必须带等级，其他维度不许带）；
      mock 按名称定级。两边都是「基础 1 / 中等 2 / 较难 3」。
   3. **挂载统计**：真实后端只给**总数**；mock 给按对象的明细。
      后端的题库与练习没有标签挂载，明细里的这两列没有后端口径。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createAdminTag,
  deleteAdminTag,
  isBackendEnabled,
  loadAdminTags,
  loadTagDescendants,
  updateAdminTag,
} from "@exam/shared/api";
import { DIFFICULTY_LABEL } from "@exam/shared/engine/paper";
import { writeAudit } from "@exam/shared/mock/adminOps";
import type { TagGroup } from "@exam/shared/domain/types";
import {
  createTag,
  removeTag,
  updateTag,
  usageOf,
  useCatalog,
} from "@exam/shared/mock/catalog";

/** 标签清单的一行（mock 与 HTTP 同一形状）。 */
export interface TagRow {
  id: string;
  /** 编码：唯一且不可改（mock 模式为空）。 */
  code: string;
  name: string;
  group: TagGroup;
  /** 难度等级；只有难度维度有。 */
  level: number | null;
  /** 父标签；顶级为 null。 */
  parentId: string | null;
  /** 挂载总数。 */
  usageCount: number;
  /** 按对象的挂载明细；真实后端只给总数，这里为空。 */
  breakdown: { questions: number; banks: number; exams: number; practices: number } | null;
}

/** 标签名称 → 难度等级（基础 1 / 中等 2 / 较难 3，其余按「中等」兜底）。 */
function difficultyLevelByName(name: string): 1 | 2 | 3 {
  const hit = (Object.keys(DIFFICULTY_LABEL) as unknown as Array<"1" | "2" | "3">).find(
    (level) => DIFFICULTY_LABEL[Number(level) as 1 | 2 | 3] === name,
  );
  return hit ? (Number(hit) as 1 | 2 | 3) : 2;
}

/**
 * 标签名 → 编码。
 *
 * 编码只允许字母（含中文）、数字、下划线、点与中划线；
 * 其余字符（空格、括号等）换成中划线。
 */
export function deriveTagCode(group: TagGroup, name: string): string {
  const safe = Array.from(name.trim())
    .map((ch) =>
      /[A-Za-z0-9_.-]/.test(ch) || (/[㐀-鿿]/.test(ch) && ch.trim() !== "")
        ? ch
        : "-",
    )
    .join("");
  return `${group}.${safe}`;
}

/** 标签管理的数据通路。 */
export function useAdminTags(): {
  tags: TagRow[];
  loading: boolean;
  refresh: () => void;
  create: (input: { name: string; group: TagGroup; code?: string; parentId?: string | null }) => Promise<void>;
  update: (input: {
    id: string;
    name: string;
    group: TagGroup;
    parentId?: string | null;
  }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** 这个标签下面挂着哪些标签（子树，含子孙）。 */
  descendants: (id: string) => Promise<TagRow[]>;
} {
  const remote = isBackendEnabled();
  const mockTags = useCatalog((state) => state.tags);

  const [remoteTags, setRemoteTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const tags = await loadAdminTags();
        if (cancelled) return;
        setRemoteTags(
          tags.map((tag) => ({
            id: tag.id,
            code: tag.code,
            name: tag.name,
            group: tag.group,
            level: tag.level,
            parentId: tag.parentId,
            usageCount: tag.usageCount,
            breakdown: null,
          })),
        );
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

  const mockRows = useMemo<TagRow[]>(
    () =>
      mockTags.map((tag) => {
        const usage = usageOf(tag.id);
        return {
          id: tag.id,
          code: "",
          name: tag.name,
          group: tag.group,
          level: tag.level ?? null,
          parentId: tag.parentId ?? null,
          usageCount: usage.total,
          breakdown: {
            questions: usage.questions,
            banks: usage.banks,
            exams: usage.exams,
            practices: usage.practices,
          },
        };
      }),
    [mockTags],
  );

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  const create = useCallback(
    async (input: { name: string; group: TagGroup; code?: string; parentId?: string | null }) => {
      const name = input.name.trim();
      if (!name) throw new Error("请填写标签名称");
      if (!remote) {
        const result = createTag({ name, group: input.group });
        if (!result.ok) throw new Error(result.message ?? "保存失败");
        // mock 模式补一行审计（http 模式由后端写）。
        writeAudit({
          operator: "陈砚之",
          action: "tag.create",
          targetType: "tag",
          targetId: result.tag?.id ?? "",
          summary: `新建标签「${name}」`,
          ip: "10.12.0.21",
          userAgent: "Chrome 131 / Windows",
        });
        return;
      }
      await createAdminTag({
        code: input.code?.trim() || deriveTagCode(input.group, name),
        name,
        group: input.group,
        parentId: input.parentId ?? null,
        // 难度维度必须带等级，其他维度不许带。
        level: input.group === "difficulty" ? difficultyLevelByName(name) : null,
        sortOrder: 0,
      });
      refresh();
    },
    [remote, refresh],
  );

  const update = useCallback(
    async (input: { id: string; name: string; group: TagGroup; parentId?: string | null }) => {
      const name = input.name.trim();
      if (!name) throw new Error("请填写标签名称");
      if (!remote) {
        const result = updateTag(input.id, { name, group: input.group });
        if (!result.ok) throw new Error(result.message ?? "保存失败");
        return;
      }
      await updateAdminTag(input.id, {
        name,
        parentId: input.parentId ?? null,
        level: input.group === "difficulty" ? difficultyLevelByName(name) : null,
        sortOrder: 0,
      });
      refresh();
    },
    [remote, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!remote) {
        const result = removeTag(id);
        if (!result.ok) throw new Error(result.message ?? "删除失败");
        return;
      }
      await deleteAdminTag(id);
      refresh();
    },
    [remote, refresh],
  );

  /**
   * 标签子树。
   *
   * HTTP 模式问服务端（权威）；mock 模式在本地内容仓库里按 parentId 推——
   * 同一套形状，页面不感知。
   */
  const descendants = useCallback(
    async (id: string): Promise<TagRow[]> => {
      if (remote) {
        // 要「这个标签底下挂着谁」，不含它自己（服务端接口的默认值是包含自己）。
        const subtree = await loadTagDescendants(id, { includeSelf: false });
        return subtree.tags.map((tag) => ({
          id: tag.id,
          code: tag.code,
          name: tag.name,
          group: tag.group,
          level: tag.level,
          parentId: tag.parentId,
          usageCount: tag.usageCount,
          breakdown: null,
        }));
      }
      // 本地推：父 → 子 → 孙。用访问过的集合防环。
      const childrenOf = new Map<string, string[]>();
      for (const tag of mockTags) {
        if (!tag.parentId) continue;
        const list = childrenOf.get(tag.parentId) ?? [];
        list.push(tag.id);
        childrenOf.set(tag.parentId, list);
      }
      const ids: string[] = [];
      const walk = (parentId: string) => {
        for (const childId of childrenOf.get(parentId) ?? []) {
          if (ids.includes(childId)) continue;
          ids.push(childId);
          walk(childId);
        }
      };
      walk(id);
      return mockRows.filter((row) => ids.includes(row.id));
    },
    [remote, mockTags, mockRows],
  );

  return {
    tags: remote ? remoteTags : mockRows,
    loading,
    refresh,
    create,
    update,
    remove,
    descendants,
  };
}
