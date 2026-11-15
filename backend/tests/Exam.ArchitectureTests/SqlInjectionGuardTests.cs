using Shouldly;

namespace Exam.ArchitectureTests;

/// <summary>
/// SQL 注入防线。
/// <para>
/// 仓储层只允许**参数化**的原生 SQL：<c>FromSqlRaw</c> / <c>ExecuteSqlRaw</c> 传常量字符串，
/// 或者用 <c>FromSqlInterpolated</c> / <c>ExecuteSqlRawInterpolated</c>（EF 会把插值转成参数）。
/// 字符串拼接出来的 SQL 一律不允许——哪怕拼进去的是自己写的常量。
/// </para>
/// </summary>
public sealed class SqlInjectionGuardTests
{
    /// <summary>会原样送进数据库的原生 SQL 方法。</summary>
    private static readonly string[] RawSqlMethods =
    [
        "FromSqlRaw",
        "ExecuteSqlRaw",
    ];

    [Fact]
    public void 仓储层不得拼接SQL()
    {
        var infrastructure = FindInfrastructureDirectory();
        var offenders = new List<string>();

        foreach (var file in Directory.EnumerateFiles(infrastructure, "*.cs", SearchOption.AllDirectories))
        {
            if (file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                || file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            {
                continue;
            }

            var lines = File.ReadAllLines(file);
            for (var i = 0; i < lines.Length; i++)
            {
                var line = lines[i].Trim();

                foreach (var method in RawSqlMethods)
                {
                    var call = line.IndexOf($"{method}(", StringComparison.Ordinal);
                    if (call < 0)
                    {
                        continue;
                    }

                    // 第一个实参：插值字符串（$"..."）或字符串相加，都是拼出来的 SQL。
                    var argument = line[(call + method.Length + 1)..].TrimStart();

                    if (argument.StartsWith("$\"", StringComparison.Ordinal)
                        || argument.StartsWith("$@\"", StringComparison.Ordinal)
                        || argument.Contains(" + ", StringComparison.Ordinal))
                    {
                        offenders.Add($"{Path.GetFileName(file)}:{i + 1} {line}");
                    }
                }
            }
        }

        offenders.ShouldBeEmpty(
            "原生 SQL 必须参数化（用 FromSqlInterpolated / ExecuteSqlRawInterpolated），发现拼接：\n"
            + string.Join("\n", offenders));
    }

    [Fact]
    public void 能找到基础设施项目源码()
    {
        FindInfrastructureDirectory().ShouldNotBeNull();
    }

    /// <summary>从测试程序集的位置往上找基础设施项目目录。</summary>
    private static string FindInfrastructureDirectory()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "src", "Exam.Infrastructure");
            if (Directory.Exists(candidate))
            {
                return candidate;
            }

            directory = directory.Parent;
        }

        throw new InvalidOperationException("找不到基础设施项目源码目录。");
    }
}
