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
}
