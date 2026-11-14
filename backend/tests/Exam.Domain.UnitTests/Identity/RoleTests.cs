using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Identity;

public sealed class RoleTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 2, 0, 0, TimeSpan.Zero);

    [Fact]
    public void 系统角色不可通过自定义入口创建()
    {
        var role = Role.Create("grader_teacher", "阅卷教师", Now);

        role.IsSystem.ShouldBeFalse();
        role.Code.ShouldBe("grader_teacher");
    }

    [Fact]
    public void 角色编码为空时报错()
    {
        var act = () => Role.Create("  ", "阅卷教师", Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 角色名称为空时报错()
    {
        var act = () => Role.Create("grader", "  ", Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 重命名与改说明会更新档案()
    {
        var role = Role.Create("grader", "阅卷教师", Now, description: "初始说明");

        role.Rename("阅卷教师（高级）", Now);
        role.ChangeDescription("新的说明", Now);

        role.Name.ShouldBe("阅卷教师（高级）");
        role.Description.ShouldBe("新的说明");
    }

    [Fact]
    public void 清空说明会置为null()
    {
        var role = Role.Create("grader", "阅卷教师", Now, description: "初始说明");

        role.ChangeDescription("   ", Now);

        role.Description.ShouldBeNull();
    }
}
