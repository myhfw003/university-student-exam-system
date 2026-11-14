namespace Exam.Domain.Catalog;

/// <summary>命中模式。</summary>
public enum TagMatchMode
{
    /// <summary>命中任意一个标签即可。</summary>
    Any,

    /// <summary>必须命中全部标签。</summary>
    All,
}

/// <summary>
/// 标签筛选条件。含标签集合、是否含子标签与命中模式。
/// </summary>
public sealed record TagSelector
{
    public static readonly TagSelector Empty = new() { TagIds = [] };

    public IReadOnlyList<long> TagIds { get; init; } = [];

    /// <summary>是否把子标签一并纳入。默认包含。</summary>
    public bool IncludeDescendants { get; init; } = true;

    public TagMatchMode MatchMode { get; init; } = TagMatchMode.Any;

    public bool IsEmpty => TagIds.Count == 0;
}
