namespace Exam.Application.Common.Models;

/// <summary>分页与排序请求。Size 上限 200。</summary>
public sealed record PageRequest
{
    public const int DefaultSize = 20;
    public const int MaxSize = 200;

    public int Page { get; init; } = 1;

    public int Size { get; init; } = DefaultSize;

    public string? SortBy { get; init; }

    public bool SortDescending { get; init; }

    public int Skip => (Math.Max(Page, 1) - 1) * Math.Clamp(Size, 1, MaxSize);

    public int Take => Math.Clamp(Size, 1, MaxSize);
}

/// <summary>分页结果。</summary>
public sealed record PageResult<T>(IReadOnlyList<T> Items, int Total, int Page, int Size);
