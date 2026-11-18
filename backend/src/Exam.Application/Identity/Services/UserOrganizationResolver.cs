using Exam.Application.Common.Interfaces;
using Exam.Application.Identity.Contracts;
using Exam.Domain.Catalog;

namespace Exam.Application.Identity.Services;

/// <summary>
/// 组织归属推导服务。
/// <para>
/// 用户的组织归属只存「挂载的组织标签」，完整路径由标签层级上溯得到——
/// 组织树调整后路径自动跟随，不需要冗余字段。
/// </para>
/// </summary>
public sealed class UserOrganizationResolver
{
    private readonly IUserTagRepository _userTags;
    private readonly ITagRepository _tags;

    public UserOrganizationResolver(IUserTagRepository userTags, ITagRepository tags)
    {
        _userTags = userTags;
        _tags = tags;
    }

    /// <summary>取回用户挂载的组织标签，并推导完整路径。</summary>
    public async Task<UserTagsResponse> ResolveAsync(long userId, CancellationToken cancellationToken = default)
    {
        var resolved = await ResolveManyAsync([userId], cancellationToken);
        return resolved.TryGetValue(userId, out var single)
            ? single
            : new UserTagsResponse(userId, [], null);
    }

    /// <summary>
    /// 批量推导多个用户的组织归属。
    /// <para>
    /// 组织标签一次取回、路径一次推导：管理端用户列表要展示每个人的组织路径，
    /// 逐个调 <see cref="ResolveAsync"/> 会把查询数乘上人数。
    /// </para>
    /// </summary>
    public async Task<IReadOnlyDictionary<long, UserTagsResponse>> ResolveManyAsync(
        IReadOnlyCollection<long> userIds,
        CancellationToken cancellationToken = default)
    {
        var result = new Dictionary<long, UserTagsResponse>();
        if (userIds.Count == 0)
        {
            return result;
        }

        var links = await _userTags.GetByUsersAsync(userIds, cancellationToken);

        // 没挂标签的用户也要有条目：前端据此显示「社会人士」。
        foreach (var userId in userIds)
        {
            result[userId] = new UserTagsResponse(userId, [], null);
        }

        if (links.Count == 0)
        {
            return result;
        }

        var tagIds = links.Select(l => l.TagId).Distinct().ToList();
        var tags = await _tags.GetWithAncestorsAsync(tagIds, cancellationToken);
        var tagsById = tags.ToDictionary(t => t.Id);

        foreach (var group in links.GroupBy(l => l.UserId))
        {
            var ownTagIds = group.Select(l => l.TagId).Distinct().ToList();
            // 只在**该用户自己挂的标签**里挑最深的：祖先标签不属于任何用户。
            var ownTags = tags.Where(t => ownTagIds.Contains(t.Id)).ToList();

            var dtoList = new List<UserOrganizationTagDto>(ownTags.Count);
            foreach (var tag in ownTags)
            {
                var path = TagPathResolver.ResolvePath(tag, tagsById);
                dtoList.Add(new UserOrganizationTagDto(
                    tag.Id,
                    tag.Code,
                    tag.Name,
                    TagPathResolver.FormatPath(path)));
            }

            var deepest = TagPathResolver.SelectDeepest(ownTags, tagsById);
            var organizationPath = deepest is null
                ? null
                : TagPathResolver.FormatPath(TagPathResolver.ResolvePath(deepest, tagsById));

            result[group.Key] = new UserTagsResponse(group.Key, dtoList, organizationPath);
        }

        return result;
    }
}
