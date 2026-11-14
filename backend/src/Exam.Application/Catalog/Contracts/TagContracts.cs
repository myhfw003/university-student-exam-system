using Exam.Domain.Catalog;

namespace Exam.Application.Catalog.Contracts;

/// <summary>标签详情。</summary>
public sealed record TagDto(
    long Id,
    string Code,
    string Name,
    string Group,
    string GroupLabel,
    long? ParentId,
    int? Level,
    string? Description,
    int SortOrder,
    bool IsSystem,
    int UsageCount)
{
    public static TagDto From(Tag tag) => new(
        tag.Id,
        tag.Code,
        tag.Name,
        tag.Group.ToStorage(),
        tag.Group.Label(),
        tag.ParentId,
        tag.Level,
        tag.Description,
        tag.SortOrder,
        tag.IsSystem,
        tag.UsageCount);
}

/// <summary>按维度分组的标签。</summary>
public sealed record TagGroupDto(
    string Group,
    string Label,
    bool AllowsHierarchy,
    bool AppliesToQuestions,
    bool AppliesToUsers,
    IReadOnlyList<TagDto> Tags);

/// <summary>标签列表响应：按维度分组。</summary>
public sealed record TagGroupsResponse(IReadOnlyList<TagGroupDto> Groups);

/// <summary>标签详情响应：标签本身 + 直接子标签。</summary>
public sealed record TagDetailDto(TagDto Tag, IReadOnlyList<TagDto> Children);

/// <summary>标签后代展开结果。</summary>
public sealed record TagDescendantsResponse(
    long RootId,
    IReadOnlyList<long> Ids,
    IReadOnlyList<TagDto> Tags);
