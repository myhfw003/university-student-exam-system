using Exam.Application.Common.Interfaces;
using Exam.Domain.Learning;

namespace Exam.Application.Learning.Services;

/// <summary>
/// 练习可见性判定。
/// <para>
/// 练习开放单按**组织标签**划范围：没设范围的练习对所有人可见；
/// 设了范围的，命中范围标签（或它的子标签）的学生才看得见。
/// </para>
/// </summary>
public sealed class PracticeVisibilityResolver
{
    private readonly IPracticeAssignmentRepository _practices;
    private readonly IUserTagRepository _userTags;
    private readonly ITagRepository _tags;

    public PracticeVisibilityResolver(
        IPracticeAssignmentRepository practices,
        IUserTagRepository userTags,
        ITagRepository tags)
    {
        _practices = practices;
        _userTags = userTags;
        _tags = tags;
    }

    /// <summary>某位考生当前可见的练习开放单。</summary>
    public async Task<IReadOnlyList<PracticeAssignment>> ListVisibleAsync(
        long userId,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        var assignments = await _practices.ListPublishedOpenAsync(now, cancellationToken);
        if (assignments.Count == 0)
        {
            return assignments;
        }

        var userTagIds = (await _userTags.GetByUserAsync(userId, cancellationToken))
            .Select(ut => ut.TagId)
            .Distinct()
            .ToList();

        var visibleTagIds = new HashSet<long>(userTagIds);
        foreach (var tagId in userTagIds)
        {
            foreach (var descendantId in await _tags.GetDescendantIdsAsync(tagId, true, cancellationToken))
            {
                visibleTagIds.Add(descendantId);
            }
        }

        return assignments
            .Where(a => a.ScopeTagIds.Count == 0 || a.ScopeTagIds.Any(visibleTagIds.Contains))
            .ToList();
    }
}
