namespace Exam.Application.Common.Interfaces;

/// <summary>当前请求的调用者。由 Web 层从令牌解析并注入。</summary>
public interface ICurrentUser
{
    bool IsAuthenticated { get; }

    long? UserId { get; }

    string? Username { get; }

    string? DisplayName { get; }

    /// <summary>当前用户的权限码集合。</summary>
    IReadOnlySet<string> Permissions { get; }

    bool HasPermission(string permissionCode);

    /// <summary>
    /// 当前用户是否必须先改密码（管理员重置密码或导入名单时置位）。
    /// <para>由访问令牌里的标记判定——改密后重新签发的令牌不再带这个标记。</para>
    /// </summary>
    bool MustChangePassword { get; }
}
