using Exam.Application.Common.Markers;
using Exam.Domain.SharedKernel.Entities;
using Shouldly;

namespace Exam.ArchitectureTests;

/// <summary>
/// 分层依赖规则（P-01）。违反即测试失败。
/// </summary>
public sealed class LayerDependencyTests
{
    [Fact]
    public void 领域层不得依赖任何第三方包()
    {
        var references = typeof(Entity<>).Assembly
            .GetReferencedAssemblies()
            .Select(x => x.Name!)
            .ToArray();

        var forbidden = new[]
        {
            "Microsoft.EntityFrameworkCore",
            "Microsoft.AspNetCore",
            "MediatR",
            "FluentValidation",
            "Npgsql",
            "StackExchange.Redis",
            "Microsoft.Extensions.Identity.Core",
        };

        foreach (var name in forbidden)
        {
            references.ShouldNotContain(name, $"领域层不得引用 {name}。");
        }
    }

    [Fact]
    public void 领域层只依赖BCL与自身()
    {
        var references = typeof(Entity<>).Assembly
            .GetReferencedAssemblies()
            .Select(x => x.Name!)
            .ToArray();

        var nonBcl = references
            .Where(n => !n.StartsWith("System.", StringComparison.Ordinal)
                     && !n.StartsWith("netstandard", StringComparison.Ordinal))
            .ToArray();

        nonBcl.ShouldBeEmpty($"领域层只能引用 BCL，实际额外引用了：{string.Join("、", nonBcl)}");
    }

    [Fact]
    public void 应用层不得依赖EF与基础设施层()
    {
        var references = typeof(IAppCommand).Assembly
            .GetReferencedAssemblies()
            .Select(x => x.Name!)
            .ToArray();

        references.ShouldNotContain("Microsoft.EntityFrameworkCore");
        references.ShouldNotContain("Exam.Infrastructure");
        references.ShouldNotContain("Npgsql");
    }

    [Fact]
    public void 基础设施层不得依赖Web层()
    {
        var references = typeof(Exam.Infrastructure.Persistence.AppDbContext).Assembly
            .GetReferencedAssemblies()
            .Select(x => x.Name!)
            .ToArray();

        references.ShouldNotContain("Exam.Web");
    }

    [Fact]
    public void 领域层不得出现EF特性注解()
    {
        var efAttributeNames = new[] { "Column", "Table", "Key", "NotMapped", "MaxLength", "ForeignKey" };

        var offenders = typeof(Entity<>).Assembly
            .GetTypes()
            .SelectMany(t => t.GetCustomAttributes(inherit: true).Select(a => a.GetType().Name))
            .Where(n => efAttributeNames.Contains(n))
            .ToArray();

        offenders.ShouldBeEmpty("领域层不得使用 EF Core 特性注解。");
    }
}
