namespace Exam.Application.Common.Interfaces;

/// <summary>用户权限查询服务。用于登录时签发令牌与请求鉴权。</summary>
public interface IUserPermissionService
{
    Task<IReadOnlyCollection<string>> GetPermissionCodesAsync(long userId, CancellationToken cancellationToken = default);

    Task<IReadOnlyCollection<string>> GetRoleCodesAsync(long userId, CancellationToken cancellationToken = default);
}
