using System.Collections.Concurrent;
using Exam.Application.Common.Interfaces;
using Exam.Domain.Identity;
using Microsoft.AspNetCore.Authorization;

namespace Exam.Web.Security;

/// <summary>要求当前用户拥有指定权限点的授权需求。</summary>
public sealed class PermissionRequirement : IAuthorizationRequirement
{
    public PermissionRequirement(string permissionCode) => PermissionCode = permissionCode;

    public string PermissionCode { get; }
}

/// <summary>按权限点校验当前用户。权限码来自访问令牌的 <c>perm</c> 声明。</summary>
public sealed class PermissionAuthorizationHandler : AuthorizationHandler<PermissionRequirement>
{
    private readonly ICurrentUser _currentUser;

    public PermissionAuthorizationHandler(ICurrentUser currentUser) => _currentUser = currentUser;

    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        PermissionRequirement requirement)
    {
        if (_currentUser.HasPermission(requirement.PermissionCode))
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}

/// <summary>
/// 按权限码动态提供授权策略。策略名即权限码，
/// 因此 <c>[Authorize(Policy = PermissionCatalog.TagWrite)]</c> 可直接使用。
/// </summary>
public sealed class PermissionPolicyProvider : IAuthorizationPolicyProvider
{
    private static readonly ConcurrentDictionary<string, AuthorizationPolicy> Policies = new(StringComparer.Ordinal);

    private readonly DefaultAuthorizationPolicyProvider _fallback;

    public PermissionPolicyProvider(DefaultAuthorizationPolicyProvider fallback) => _fallback = fallback;

    public Task<AuthorizationPolicy> GetDefaultPolicyAsync() => _fallback.GetDefaultPolicyAsync();

    public Task<AuthorizationPolicy?> GetFallbackPolicyAsync() => _fallback.GetFallbackPolicyAsync();

    public Task<AuthorizationPolicy?> GetPolicyAsync(string policyName)
    {
        if (!PermissionCatalog.All.Contains(policyName, StringComparer.Ordinal))
        {
            return _fallback.GetPolicyAsync(policyName);
        }

        var policy = Policies.GetOrAdd(policyName, static name => new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .AddRequirements(new PermissionRequirement(name))
            .Build());

        return Task.FromResult<AuthorizationPolicy?>(policy);
    }
}
