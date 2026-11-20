/* ==========================================================================
   知行测评 · 标签的后端读写
   --------------------------------------------------------------------------
   标签是全系统的组织轴：题库、题目、试卷与练习都挂标签。

   两处口径要注意：
   1. **编码不可改**：新建时要给编码（唯一），改标签只能改名称与描述——
      编码是外部引用，改了会指向别处。
   2. **难度等级按维度走**：难度维度的标签必须带等级（1..5），其他维度不许带。
      前端按名称推导等级：基础 1 / 中等 2 / 较难 3，其余按「中等」兜底。
   ========================================================================== */

import { ENDPOINTS } from "./endpoints";
import { httpClient } from "./httpClient";
import type { TagGroup } from "../domain/types";

/** 标签接口所需的客户端。 */
export type TagClient = Pick<typeof httpClient, "get" | "post" | "put" | "delete">;

/** 管理端的标签。 */
export interface AdminTag {
  id: string;
  /** 编码：唯一且不可改。 */
  code: string;
  name: string;
  group: TagGroup;
  groupLabel: string;
  /** 父标签；顶级为 null。 */
  parentId: string | null;
  /** 难度等级；只有难度维度有。 */
  level: number | null;
  description: string;
  sortOrder: number;
  /** 系统标签不可删。 */
  isSystem: boolean;
  /** 挂载总数。 */
  usageCount: number;
}

type Dto = Record<string, unknown>;

function str(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 标签 DTO → 前端口径。 */
export function toAdminTag(dto: Dto): AdminTag {
  return {
    id: str(dto.id),
    code: str(dto.code),
    name: str(dto.name),
    group: str(dto.group, "domain") as TagGroup,
    groupLabel: str(dto.groupLabel),
    parentId: dto.parentId === null || dto.parentId === undefined ? null : str(dto.parentId),
    level: dto.level === null || dto.level === undefined ? null : num(dto.level),
    description: str(dto.description),
    sortOrder: num(dto.sortOrder),
    isSystem: dto.isSystem === true,
    usageCount: num(dto.usageCount),
  };
}

/** 能挂到题目上的标签。 */
export interface QuestionTag {
  id: string;
  name: string;
  /** 维度：领域 / 知识点 / 能力 / 难度。 */
  group: TagGroup;
  /** 维度中文名（服务端给的）。 */
  groupLabel: string;
  /** 难度等级；只有难度维度有。 */
  level: number | null;
}

/**
 * 读取能挂到题目上的标签。
 *
 * 组织维度的标签只挂用户、挂不到题目上——服务端按 `appliesToQuestions` 过滤，
 * 前端不再自己判断维度（维度规则是后端的）。
 */
export async function loadQuestionTags(client: TagClient = httpClient): Promise<QuestionTag[]> {
  const res = await client.get<{
    groups?: Array<{
      group?: string;
      label?: string;
      appliesToQuestions?: boolean;
      tags?: Dto[];
    }>;
  }>(ENDPOINTS.catalog.tags);

  return (res.groups ?? [])
    .filter((group) => group.appliesToQuestions === true)
    .flatMap((group) =>
      (group.tags ?? []).map((dto) => {
        const tag = toAdminTag(dto);
        return {
          id: tag.id,
          name: tag.name,
          group: tag.group,
          groupLabel: tag.groupLabel || group.label || tag.group,
          level: tag.level,
        };
      }),
    );
}

/**
 * 读取全部标签（按维度分组返回，这里摊平成一张表）。
 *
 * 组织维度的标签也在这里：管理端要看全，包括挂在用户上的那些。
 */
export async function loadAdminTags(client: TagClient = httpClient): Promise<AdminTag[]> {
  const res = await client.get<{
    groups?: Array<{ group?: string; tags?: Dto[] }>;
  } | Dto[]>(ENDPOINTS.catalog.tags);

  const groups = Array.isArray(res) ? [] : (res.groups ?? []);
  const tags = groups.flatMap((group) => group.tags ?? []);
  return tags.map(toAdminTag);
}

/** 标签子树（后代，含子孙）。 */
export interface TagDescendants {
  /** 根标签 ID。 */
  rootId: string;
  /** 后代标签 ID。 */
  ids: string[];
  /** 后代标签。 */
  tags: AdminTag[];
}

/**
 * 展开标签的全部后代（含子孙）。
 *
 * 标签是树：同维度内可设父标签（领域 → 知识点、能力 → 子能力）。
 * 这份子树由服务端给——前端本地按 `parentId` 推只是「按列表推」，
 * 标签列表被筛选过的时候就不准了。
 *
 * `includeSelf` 默认**不把自己算进去**：调用方要的多半是「这个标签底下
 * 挂着谁」，把自己列进去会重复。（服务端接口的默认值是包含自己。）
 */
export async function loadTagDescendants(
  id: string,
  options: { includeSelf?: boolean } = {},
  client: TagClient = httpClient,
): Promise<TagDescendants> {
  const res = await client.get<{ rootId?: Dto; ids?: Dto[]; tags?: Dto[] }>(
    `${ENDPOINTS.catalog.tags}/${id}/descendants`,
    { query: { includeSelf: options.includeSelf === true ? "true" : "false" } },
  );
  return {
    rootId: str(res.rootId),
    ids: Array.isArray(res.ids) ? res.ids.map((value) => str(value)) : [],
    tags: Array.isArray(res.tags) ? res.tags.map(toAdminTag) : [],
  };
}

/** 新建标签。 */
export async function createAdminTag(
  input: {
    code: string;
    name: string;
    group: TagGroup;
    parentId?: string | null;
    level?: number | null;
    description?: string;
    sortOrder?: number;
  },
  client: TagClient = httpClient,
): Promise<AdminTag> {
  const res = await client.post<Dto>(ENDPOINTS.catalog.tags, {
    code: input.code,
    name: input.name,
    group: input.group,
    parentId: input.parentId ? Number(input.parentId) : null,
    level: input.level ?? null,
    description: input.description ?? "",
    sortOrder: input.sortOrder ?? 0,
  });
  return toAdminTag(res);
}

/** 修改标签（编码不可改）。 */
export async function updateAdminTag(
  id: string,
  input: {
    name: string;
    parentId?: string | null;
    level?: number | null;
    description?: string;
    sortOrder?: number;
  },
  client: TagClient = httpClient,
): Promise<AdminTag> {
  const res = await client.put<Dto>(`${ENDPOINTS.catalog.tags}/${id}`, {
    name: input.name,
    parentId: input.parentId ? Number(input.parentId) : null,
    level: input.level ?? null,
    description: input.description ?? "",
    sortOrder: input.sortOrder ?? 0,
  });
  return toAdminTag(res);
}

/** 删除标签（会级联解除挂载）。 */
export async function deleteAdminTag(id: string, client: TagClient = httpClient): Promise<void> {
  await client.delete(`${ENDPOINTS.catalog.tags}/${id}`);
}
