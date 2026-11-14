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
        var links = await _userTags.GetByUserAsync(userId, cancellationToken);
        if (links.Count == 0)
        {
            return new UserTagsResponse(userId, [], null);
        }

        var tagIds = links.Select(l => l.TagId).ToList();
        var tags = await _tags.GetWithAncestorsAsync(tagIds, cancellationToken);
        var tagsById = tags.ToDictionary(t => t.Id);

        var result = new List<UserOrganizationTagDto>(tags.Count);
        foreach (var tag in tags.Where(t => tagIds.Contains(t.Id)))
        {
            var path = TagPathResolver.ResolvePath(tag, tagsById);
            result.Add(new UserOrganizationTagDto(
                tag.Id,
                tag.Code,
                tag.Name,
                TagPathResolver.FormatPath(path)));
        }

        var deepest = TagPathResolver.SelectDeepest(tags, tagsById);
        var organizationPath = deepest is null
            ? null
            : TagPathResolver.FormatPath(TagPathResolver.ResolvePath(deepest, tagsById));

        return new UserTagsResponse(userId, result, organizationPath);
    }
}
