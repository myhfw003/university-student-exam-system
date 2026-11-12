using System.Security.Claims;
using Exam.Application.Common.Interfaces;
using Microsoft.AspNetCore.Http;

namespace Exam.Web.Security;

/// <summary>从 HttpContext 的令牌声明中解析当前调用者。绝不信任请求体中的用户标识。</summary>
public sealed class HttpCurrentUser : ICurrentUser
{
    private readonly IHttpContextAccessor _accessor;

    public HttpCurrentUser(IHttpContextAccessor accessor) => _accessor = accessor;

    private ClaimsPrincipal? Principal => _accessor.HttpContext?.User;

    public bool IsAuthenticated => Principal?.Identity?.IsAuthenticated == true;

    public long? UserId
    {
        get
        {
            var value = Principal?.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? Principal?.FindFirstValue("sub");
            return long.TryParse(value, out var id) ? id : null;
        }
    }

    public string? Username =>
        Principal?.FindFirstValue("unique_name")
        ?? Principal?.FindFirstValue(ClaimTypes.Name);

    public string? DisplayName => Username;

    public IReadOnlySet<string> Permissions =>
        Principal?.FindAll("perm").Select(c => c.Value).ToHashSet(StringComparer.Ordinal)
        ?? new HashSet<string>(StringComparer.Ordinal);

    public bool HasPermission(string permissionCode) => Permissions.Contains(permissionCode);
}
