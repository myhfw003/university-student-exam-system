namespace Exam.Application.Common.Interfaces;

/// <summary>
/// 用户的实时权限集合。
/// <para>
/// 权限不直接信任令牌里的声明：角色调整后必须在**下一次请求**即生效，
/// 因此这里按需读取并缓存权限集，角色变更时显式失效缓存。
/// </para>
/// </summary>
public interface IPermissionProvider
{
    /// <summary>取回用户当前拥有的权限码集合。</summary>
    Task<IReadOnlySet<string>> GetPermissionsAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>让缓存失效。角色或角色权限变更后必须调用。</summary>
    Task InvalidateAsync(long userId, CancellationToken cancellationToken = default);
}
