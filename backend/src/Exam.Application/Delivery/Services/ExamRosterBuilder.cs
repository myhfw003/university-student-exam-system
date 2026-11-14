using Exam.Application.Common.Interfaces;
using Exam.Domain.Catalog;
using Exam.Domain.Delivery;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Application.Delivery.Services;

/// <summary>
/// 名单展开（应用层服务）。
/// <para>
/// 按组织标签展开时含子标签；名单在场次发布时物化，之后与标签解耦。
/// 全员开放不物化名单——谁登录谁都能进。
/// </para>
/// </summary>
public sealed class ExamRosterBuilder
{
    private readonly ITagRepository _tags;
    private readonly IUserRepository _users;

    public ExamRosterBuilder(ITagRepository tags, IUserRepository users)
    {
        _tags = tags;
        _users = users;
    }

    /// <summary>按场次的纳入方式展开出考生 ID 集合。</summary>
    public async Task<IReadOnlyList<long>> ResolveUserIdsAsync(
        ExamSession session,
        CancellationToken cancellationToken = default) =>
        session.ParticipantMode switch
        {
            ParticipantMode.FromTags => await ResolveByTagsAsync(session.ParticipantTagIds, cancellationToken),
            ParticipantMode.Direct => session.ParticipantUserIds.Distinct().ToList(),
            _ => [],
        };

    /// <summary>按组织标签（含子标签）展开考生。</summary>
    public async Task<IReadOnlyList<long>> ResolveByTagsAsync(
        IReadOnlyList<long> tagIds,
        CancellationToken cancellationToken = default)
    {
        if (tagIds.Count == 0)
        {
            return [];
        }

        var tags = await _tags.GetByIdsAsync(tagIds, cancellationToken);
        var missing = tagIds.Except(tags.Select(t => t.Id)).ToList();
        if (missing.Count > 0)
        {
            throw new BusinessRuleException("名单标签不存在。");
        }

        if (tags.Any(t => t.Group != TagGroup.Organization))
        {
            throw new BusinessRuleException("名单只能按组织维度标签纳入。");
        }

        // 含子标签：命中子标签的人也在这场考试的名单里。
        var expanded = new List<long>();
        foreach (var tag in tags)
        {
            expanded.AddRange(await _tags.GetDescendantIdsAsync(tag.Id, true, cancellationToken));
        }

        expanded = expanded.Distinct().ToList();
        var userIds = await _users.GetUserIdsByTagIdsAsync(expanded, cancellationToken);
        return userIds.Distinct().OrderBy(id => id).ToList();
    }
}
