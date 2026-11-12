using System.Reflection;
using Shouldly;

namespace Exam.ArchitectureTests;

/// <summary>
/// 命名规范（P-02）：禁止 Manager / Helper / Util 等通用词。
/// </summary>
public sealed class NamingConventionTests
{
    private static readonly string[] ForbiddenSuffixes =
    [
        "Manager", "Helper", "Util", "Utils", "Wrapper", "DataService", "FactoryHelper",
    ];

    [Fact]
    public void 类型命名不得使用通用词()
    {
        var assembly = typeof(Exam.Domain.SharedKernel.Entities.Entity<>).Assembly;
        var offenders = assembly.GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false })
            .Where(t => ForbiddenSuffixes.Any(s => t.Name.EndsWith(s, StringComparison.Ordinal)))
            .Select(t => t.Name)
            .ToArray();

        offenders.ShouldBeEmpty($"以下类型命名使用了通用词：{string.Join("、", offenders)}");
    }

    [Fact]
    public void 公共类型必须有命名空间()
    {
        var assembly = typeof(Exam.Domain.SharedKernel.Entities.Entity<>).Assembly;
        var offenders = assembly.GetTypes()
            .Where(t => t.IsPublic && string.IsNullOrWhiteSpace(t.Namespace))
            .Select(t => t.Name)
            .ToArray();

        offenders.ShouldBeEmpty("公共类型必须位于命名空间中。");
    }
}
