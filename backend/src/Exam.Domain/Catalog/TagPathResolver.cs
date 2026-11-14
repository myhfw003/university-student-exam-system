namespace Exam.Domain.Catalog;

/// <summary>
/// 组织路径推导。
/// <para>
/// 用户的组织归属只存「最深的一级标签」，完整路径由标签层级上溯得到，
/// 不单独存字段——组织树调整后路径自动跟随。
/// </para>
/// </summary>
public static class TagPathResolver
{
    /// <summary>
    /// 从标签沿父链上溯，得到自根到该标签的完整路径（含自身）。
    /// 层级数据损坏导致成环时返回已走过的部分，不死循环。
    /// </summary>
    public static IReadOnlyList<Tag> ResolvePath(Tag leaf, IReadOnlyDictionary<long, Tag> tagsById)
    {
        var path = new List<Tag>();
        var visited = new HashSet<long>();

        var current = leaf;
        while (current is not null && visited.Add(current.Id))
        {
            path.Add(current);
            current = current.ParentId is { } parentId && tagsById.TryGetValue(parentId, out var parent)
                ? parent
                : null;
        }

        path.Reverse();
        return path;
    }

    /// <summary>
    /// 在用户挂载的多个组织标签中选出最深的一个（层级最长）。
    /// 「计算机学院 / 计算机科学与技术 / 计科 2301 班」中，班级才是用户归属。
    /// </summary>
    public static Tag? SelectDeepest(IReadOnlyCollection<Tag> candidates, IReadOnlyDictionary<long, Tag> tagsById)
    {
        Tag? deepest = null;
        var deepestLength = -1;

        foreach (var candidate in candidates)
        {
            var length = ResolvePath(candidate, tagsById).Count;
            if (length > deepestLength)
            {
                deepest = candidate;
                deepestLength = length;
            }
        }

        return deepest;
    }

    /// <summary>把路径拼成人类可读的文本，例如「计算机学院 / 计算机科学与技术 / 计科 2301 班」。</summary>
    public static string FormatPath(IReadOnlyList<Tag> path) =>
        string.Join(" / ", path.Select(t => t.Name));
}
