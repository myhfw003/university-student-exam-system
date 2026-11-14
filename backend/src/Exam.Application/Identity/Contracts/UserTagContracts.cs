namespace Exam.Application.Identity.Contracts;

/// <summary>用户挂载的组织标签，含推导出的完整路径。</summary>
public sealed record UserOrganizationTagDto(long Id, string Code, string Name, string Path);

/// <summary>用户的组织归属。</summary>
public sealed record UserTagsResponse(
    long UserId,
    IReadOnlyList<UserOrganizationTagDto> Tags,
    string? OrganizationPath);
