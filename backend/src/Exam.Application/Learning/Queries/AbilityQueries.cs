using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Learning.Contracts;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Learning.Queries;

/// <summary>
/// 能力画像。
/// <para>
/// 样本足够的画像参与排序；样本不足的排在后面，并标注「样本不足」。
/// </para>
/// </summary>
public sealed record GetAbilityProfileQuery()
    : IAppQuery<AbilityProfileResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptReadOwn];
}

public sealed class GetAbilityProfileHandler : IRequestHandler<GetAbilityProfileQuery, AbilityProfileResponse>
{
    /// <summary>掌握度分档的门槛。</summary>
    private const decimal MasteredThreshold = 0.8m;

    /// <summary>熟悉门槛。</summary>
    private const decimal FamiliarThreshold = 0.6m;

    private readonly IAbilityProfileRepository _profiles;
    private readonly ITagRepository _tags;
    private readonly ICurrentUser _currentUser;

    public GetAbilityProfileHandler(
        IAbilityProfileRepository profiles,
        ITagRepository tags,
        ICurrentUser currentUser)
    {
        _profiles = profiles;
        _tags = tags;
        _currentUser = currentUser;
    }

    public async Task<AbilityProfileResponse> Handle(
        GetAbilityProfileQuery request,
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录。");

        var profiles = await _profiles.ListByUserAsync(userId, cancellationToken);
        if (profiles.Count == 0)
        {
            return new AbilityProfileResponse([], 0, 0);
        }

        var tags = await _tags.GetByIdsAsync(
            profiles.Select(p => p.AbilityTagId).Distinct().ToList(),
            cancellationToken);

        var tagNameById = tags.ToDictionary(t => t.Id, t => t.Name);

        var items = profiles
            .Select(p =>
            {
                var sufficient = p.IsSampleSufficient;

                return new AbilityProfileDto(
                    p.AbilityTagId,
                    tagNameById.GetValueOrDefault(p.AbilityTagId, string.Empty),
                    p.MasteryRate,
                    p.SampleSize,
                    p.CorrectCount,
                    sufficient,
                    Label(p.MasteryRate, sufficient));
            })
            .ToList();

        // 样本足够的参与排序；样本不足的排在后面，不参与排序。
        var ordered = items
            .OrderByDescending(i => i.SampleSufficient)
            .ThenByDescending(i => i.MasteryRate)
            .ThenBy(i => i.AbilityTagId)
            .ToList();

        return new AbilityProfileResponse(
            ordered,
            ordered.Count,
            ordered.Count(i => !i.SampleSufficient));
    }

    private static string Label(decimal masteryRate, bool sufficient)
    {
        if (!sufficient)
        {
            return "样本不足";
        }

        if (masteryRate >= MasteredThreshold)
        {
            return "掌握";
        }

        return masteryRate >= FamiliarThreshold ? "熟悉" : "薄弱";
    }
}
