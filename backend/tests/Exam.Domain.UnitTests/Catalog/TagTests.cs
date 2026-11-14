using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Catalog;

public sealed class TagTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 1, 0, 0, TimeSpan.Zero);

    private static Tag DomainTag(string code = "math", string name = "高等数学", long? parentId = null) =>
        Tag.Create(code, name, TagGroup.Domain, null, null, 0, Now);

    [Fact]
    public void 难度维度必须带难度等级()
    {
        var act = () => Tag.Create("d1", "基础", TagGroup.Difficulty, null, null, 0, Now);

        var ex = act.ShouldThrow<BusinessRuleException>();
        ex.Message.ShouldContain("难度等级");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(6)]
    public void 难度等级超出范围时被拒绝(int level)
    {
        var act = () => Tag.Create("d1", "基础", TagGroup.Difficulty, level, null, 0, Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 非难度维度不允许带难度等级()
    {
        var act = () => Tag.Create("math", "高等数学", TagGroup.Domain, 3, null, 0, Now);

        var ex = act.ShouldThrow<BusinessRuleException>();
        ex.Message.ShouldContain("难度等级");
    }

    [Fact]
    public void 难度维度不允许挂父标签()
    {
        var tag = Tag.Create("d1", "基础", TagGroup.Difficulty, 1, null, 0, Now);
        var parent = DomainTag();

        var act = () => tag.SetParent(parent, Now);

        var ex = act.ShouldThrow<BusinessRuleException>();
        ex.Message.ShouldContain("没有层级关系");
    }

    [Fact]
    public void 父标签必须与当前标签同维度()
    {
        var tag = DomainTag();
        var parent = Tag.Create("org.faculty", "计算机学院", TagGroup.Organization, null, null, 0, Now);

        var act = () => tag.SetParent(parent, Now);

        var ex = act.ShouldThrow<BusinessRuleException>();
        ex.Message.ShouldContain("同一维度");
    }

    [Fact]
    public void 标签不能以自身为父标签()
    {
        var tag = DomainTag();
        // 通过反射把 Id 设成非零，模拟已持久化的标签。
        typeof(Exam.Domain.SharedKernel.Entities.Entity<long>)
            .GetProperty(nameof(Exam.Domain.SharedKernel.Entities.Entity<long>.Id))!
            .SetValue(tag, 42L);

        var act = () => tag.SetParent(tag, Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 系统预置标签不可删除()
    {
        var tag = Tag.Create("d1", "基础", TagGroup.Difficulty, 1, null, 0, Now, isSystem: true);

        var act = () => tag.EnsureDeletable(hasChildren: false, usedByUsers: false, usedByQuestions: false);

        var ex = act.ShouldThrow<TagInUseException>();
        ex.ErrorCode.ShouldBe(ErrorCodes.TagInUse);
    }

    [Fact]
    public void 有子标签的标签不可删除()
    {
        var tag = DomainTag();

        var act = () => tag.EnsureDeletable(hasChildren: true, usedByUsers: false, usedByQuestions: false);

        act.ShouldThrow<TagInUseException>();
    }

    [Fact]
    public void 被用户或题目引用的标签不可删除()
    {
        var tag = DomainTag();

        Should.Throw<TagInUseException>(
            () => tag.EnsureDeletable(false, usedByUsers: true, usedByQuestions: false));
        Should.Throw<TagInUseException>(
            () => tag.EnsureDeletable(false, usedByUsers: false, usedByQuestions: true));
    }

    [Fact]
    public void 无引用的普通标签可以删除()
    {
        var tag = DomainTag();

        Should.NotThrow(() => tag.EnsureDeletable(false, usedByUsers: false, usedByQuestions: false));
    }

    [Fact]
    public void 引用次数不得为负()
    {
        var tag = DomainTag();

        tag.IncrementUsage();
        tag.IncrementUsage();
        tag.DecrementUsage();

        tag.UsageCount.ShouldBe(1);

        tag.DecrementUsage();
        var act = () => tag.DecrementUsage();
        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 标签编码只允许字母数字与下划线点中划线()
    {
        var act = () => Tag.Create("math/limit", "极限", TagGroup.Domain, null, null, 0, Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 标签名称不能为空()
    {
        var act = () => Tag.Create("math", "   ", TagGroup.Domain, null, null, 0, Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 维度存储值与中文标签映射正确()
    {
        TagGroup.Domain.ToStorage().ShouldBe("domain");
        TagGroup.KnowledgePoint.ToStorage().ShouldBe("knowledge_point");
        TagGroup.Ability.ToStorage().ShouldBe("ability");
        TagGroup.Difficulty.ToStorage().ShouldBe("difficulty");
        TagGroup.Organization.ToStorage().ShouldBe("organization");

        TagGroups.FromStorage("organization").ShouldBe(TagGroup.Organization);
        TagGroups.FromStorage("unknown").ShouldBeNull();

        TagGroup.Domain.Label().ShouldBe("领域");
        TagGroup.Difficulty.Label().ShouldBe("难度");
    }

    [Fact]
    public void 只有难度维度不允许层级()
    {
        TagGroup.Difficulty.AllowsHierarchy().ShouldBeFalse();
        TagGroup.Domain.AllowsHierarchy().ShouldBeTrue();
        TagGroup.Organization.AllowsHierarchy().ShouldBeTrue();
    }

    [Fact]
    public void 组织维度只适用于用户()
    {
        TagGroup.Organization.AppliesToQuestions().ShouldBeFalse();
        TagGroup.Organization.AppliesToUsers().ShouldBeTrue();

        foreach (var group in new[] { TagGroup.Domain, TagGroup.KnowledgePoint, TagGroup.Ability, TagGroup.Difficulty })
        {
            group.AppliesToQuestions().ShouldBeTrue();
            group.AppliesToUsers().ShouldBeFalse();
        }
    }
}
