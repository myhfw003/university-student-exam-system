namespace Exam.Application.Common.Markers;

/// <summary>
/// 需要权限校验的请求。由 AuthorizationBehavior 在管道内强制执行，
/// 与 Controller 上的 [Authorize] 形成双保险。
/// </summary>
public interface IAuthorizableRequest
{
    /// <summary>调用该请求所需的权限码。空集合表示只需登录。</summary>
    IReadOnlyCollection<string> RequiredPermissions { get; }
}
