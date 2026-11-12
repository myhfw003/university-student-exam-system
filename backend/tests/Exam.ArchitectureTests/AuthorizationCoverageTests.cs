using Exam.Application.Common.Markers;
using Shouldly;

namespace Exam.ArchitectureTests;

/// <summary>
/// 写命令必须声明权限需求（IAuthorizableRequest），否则可能绕过鉴权。
/// 仅登录与刷新两个匿名入口在白名单中。
/// </summary>
public sealed class AuthorizationCoverageTests
{
    private static readonly HashSet<string> AnonymousCommands = new(StringComparer.Ordinal)
    {
        "LoginCommand",
        "RefreshAccessTokenCommand",
    };

    [Fact]
    public void 所有写命令都必须声明权限需求()
    {
        var assembly = typeof(IAppCommand).Assembly;

        var offenders = assembly.GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false })
            .Where(t => typeof(IAppWriteRequest).IsAssignableFrom(t))
            .Where(t => !typeof(IAuthorizableRequest).IsAssignableFrom(t))
            .Where(t => !AnonymousCommands.Contains(t.Name))
            .Select(t => t.Name)
            .ToArray();

        offenders.ShouldBeEmpty($"以下写命令未声明权限需求：{string.Join("、", offenders)}");
    }

    [Fact]
    public void 匿名命令白名单中的类型必须真实存在()
    {
        var assembly = typeof(IAppCommand).Assembly;

        foreach (var name in AnonymousCommands)
        {
            assembly.GetTypes().ShouldContain(t => t.Name == name, $"白名单中的 {name} 不存在。");
        }
    }
}
