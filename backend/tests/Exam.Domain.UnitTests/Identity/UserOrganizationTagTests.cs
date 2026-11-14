using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.Identity.Events;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Identity;

public sealed class UserOrganizationTagTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 3, 0, 0, TimeSpan.Zero);

    [Fact]
    public void 挂载组织维度标签_接受()
    {
        var user = User.Register("zhangsan", "张三", "hash", Now);
        var clazz = Tag.Create("org.faculty.cs.c2301", "计科 2301 班", TagGroup.Organization, null, null, 0, Now);

        user.AssignTags([clazz], [], Now);

        user.DomainEvents.ShouldContain(e => e is UserTagsChanged);
    }

    [Fact]
    public void 挂载非组织维度标签_拒绝()
    {
        var user = User.Register("zhangsan", "张三", "hash", Now);
        var domain = Tag.Create("math", "高等数学", TagGroup.Domain, null, null, 0, Now);

        var act = () => user.AssignTags([domain], [], Now);

        var ex = act.ShouldThrow<BusinessRuleException>();
        ex.Message.ShouldContain("组织维度");
    }

    [Fact]
    public void 难度维度标签同样不可挂到用户上()
    {
        var user = User.Register("zhangsan", "张三", "hash", Now);
        var difficulty = Tag.Create("difficulty.basic", "基础", TagGroup.Difficulty, 1, null, 0, Now);

        var act = () => user.AssignTags([difficulty], [], Now);

        act.ShouldThrow<BusinessRuleException>();
    }
}
