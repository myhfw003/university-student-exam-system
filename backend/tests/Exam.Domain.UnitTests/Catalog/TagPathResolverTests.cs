using Exam.Domain.Catalog;
using Shouldly;

namespace Exam.Domain.UnitTests.Catalog;

public sealed class TagPathResolverTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 3, 0, 0, TimeSpan.Zero);

    private static Tag Organization(string code, string name, long id, Tag? parent = null)
    {
        var tag = Tag.Create(code, name, TagGroup.Organization, null, null, 0, Now);
        typeof(Exam.Domain.SharedKernel.Entities.Entity<long>)
            .GetProperty(nameof(Exam.Domain.SharedKernel.Entities.Entity<long>.Id))!
            .SetValue(tag, id);

        if (parent is not null)
        {
            tag.SetParent(parent, Now);
        }

        return tag;
    }

    [Fact]
    public void 组织路径自根到叶依次展开()
    {
        var faculty = Organization("org.faculty", "计算机学院", 1);
        var major = Organization("org.faculty.cs", "计算机科学与技术", 2, faculty);
        var clazz = Organization("org.faculty.cs.c2301", "计科 2301 班", 3, major);

        var tags = new Dictionary<long, Tag> { [1] = faculty, [2] = major, [3] = clazz };

        var path = TagPathResolver.ResolvePath(clazz, tags);

        path.Select(t => t.Name).ShouldBe(["计算机学院", "计算机科学与技术", "计科 2301 班"]);
        TagPathResolver.FormatPath(path).ShouldBe("计算机学院 / 计算机科学与技术 / 计科 2301 班");
    }

    [Fact]
    public void 多个挂载中取层级最深的作为归属()
    {
        var faculty = Organization("org.faculty", "计算机学院", 1);
        var clazz = Organization("org.faculty.cs.c2301", "计科 2301 班", 3, faculty);
        var tags = new Dictionary<long, Tag> { [1] = faculty, [3] = clazz };

        var deepest = TagPathResolver.SelectDeepest([faculty, clazz], tags);

        deepest.ShouldNotBeNull();
        deepest!.Name.ShouldBe("计科 2301 班");
    }

    [Fact]
    public void 层级成环时不死循环()
    {
        var a = Organization("org.a", "A", 1);
        var b = Organization("org.b", "B", 2, a);
        a.SetParent(b, Now);

        var tags = new Dictionary<long, Tag> { [1] = a, [2] = b };

        var path = TagPathResolver.ResolvePath(a, tags);

        path.Count.ShouldBeLessThanOrEqualTo(2);
    }
}
