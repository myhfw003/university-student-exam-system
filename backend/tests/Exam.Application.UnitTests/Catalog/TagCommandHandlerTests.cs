using Exam.Application.Catalog.Commands;
using Exam.Application.Catalog.Queries;
using Exam.Application.Common.Interfaces;
using Exam.Application.UnitTests.Identity;
using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using NSubstitute;
using Shouldly;

namespace Exam.Application.UnitTests.Catalog;

public sealed class TagCommandHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 1, 0, 0, TimeSpan.Zero);

    private readonly ITagRepository _tags = Substitute.For<ITagRepository>();
    private readonly IClock _clock = new FixedClock(Now);
    private readonly ICurrentUser _currentUser = Substitute.For<ICurrentUser>();
    private readonly IUnitOfWork _unitOfWork = Substitute.For<IUnitOfWork>();
    private readonly IUserTagRepository _userTags = Substitute.For<IUserTagRepository>();

    /// <summary>给标签赋主键，模拟已持久化的实体。</summary>
    private static Tag WithId(Tag tag, long id)
    {
        typeof(Exam.Domain.SharedKernel.Entities.Entity<long>)
            .GetProperty(nameof(Exam.Domain.SharedKernel.Entities.Entity<long>.Id))!
            .SetValue(tag, id);
        return tag;
    }

    private CreateTagHandler CreateHandler() => new(_tags, _clock, _currentUser, _unitOfWork);

    private UpdateTagHandler UpdateHandler() => new(_tags, _clock, _currentUser);

    private DeleteTagHandler DeleteHandler() => new(_tags, _userTags, _clock, _currentUser);

    [Fact]
    public async Task 新建标签_编码重复时报错()
    {
        _tags.GetByCodeAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(Tag.Create("math", "高等数学", TagGroup.Domain, null, null, 0, Now));

        var act = async () => await CreateHandler().Handle(
            new CreateTagCommand("math", "高等数学", "domain", null, null, null, 0),
            CancellationToken.None);

        var ex = await act.ShouldThrowAsync<DuplicateCodeException>();
        ex.ErrorCode.ShouldBe(ErrorCodes.DuplicateCode);
    }

    [Fact]
    public async Task 新建标签_父标签维度不一致时报错()
    {
        _tags.GetByCodeAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((Tag?)null);
        _tags.GetByIdAsync(Arg.Any<long>(), Arg.Any<CancellationToken>())
            .Returns(Tag.Create("org.faculty", "计算机学院", TagGroup.Organization, null, null, 0, Now));

        var act = async () => await CreateHandler().Handle(
            new CreateTagCommand("math.limit", "极限", "domain", 7, null, null, 0),
            CancellationToken.None);

        var ex = await act.ShouldThrowAsync<BusinessRuleException>();
        ex.Message.ShouldContain("同一维度");
    }

    [Fact]
    public async Task 新建标签_难度维度带父标签时报错()
    {
        _tags.GetByCodeAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((Tag?)null);
        _tags.GetByIdAsync(Arg.Any<long>(), Arg.Any<CancellationToken>())
            .Returns(Tag.Create("math", "高等数学", TagGroup.Domain, null, null, 0, Now));

        var act = async () => await CreateHandler().Handle(
            new CreateTagCommand("d1", "基础", "difficulty", 7, 1, null, 0),
            CancellationToken.None);

        var ex = await act.ShouldThrowAsync<BusinessRuleException>();
        ex.Message.ShouldContain("没有层级关系");
    }

    [Fact]
    public async Task 新建标签_成功返回标签视图()
    {
        _tags.GetByCodeAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((Tag?)null);
        _tags.GetByIdAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns((Tag?)null);

        var result = await CreateHandler().Handle(
            new CreateTagCommand("math.limit", "极限", "domain", null, null, "极限与连续", 3),
            CancellationToken.None);

        result.Code.ShouldBe("math.limit");
        result.Name.ShouldBe("极限");
        result.Group.ShouldBe("domain");
        result.GroupLabel.ShouldBe("领域");
        result.SortOrder.ShouldBe(3);
        await _tags.Received(1).AddAsync(Arg.Any<Tag>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task 修改标签_父标签在自己的后代中时报环错误()
    {
        var tag = WithId(Tag.Create("math", "高等数学", TagGroup.Domain, null, null, 0, Now), 1);
        var child = WithId(Tag.Create("math.limit", "极限", TagGroup.Domain, null, null, 0, Now), 2);

        _tags.GetByIdAsync(1, Arg.Any<CancellationToken>()).Returns(tag);
        _tags.GetByIdAsync(2, Arg.Any<CancellationToken>()).Returns(child);
        _tags.GetDescendantIdsAsync(1, true, Arg.Any<CancellationToken>()).Returns(new long[] { 1, 2 });

        var act = async () => await UpdateHandler().Handle(
            new UpdateTagCommand(1, "高等数学", 2, null, null, 0),
            CancellationToken.None);

        var ex = await act.ShouldThrowAsync<TagCycleException>();
        ex.ErrorCode.ShouldBe(ErrorCodes.TagCycleDetected);
    }

    [Fact]
    public async Task 修改标签_难度维度不允许有父标签()
    {
        var tag = Tag.Create("d1", "基础", TagGroup.Difficulty, 1, null, 0, Now);
        _tags.GetByIdAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns(tag);

        var act = async () => await UpdateHandler().Handle(
            new UpdateTagCommand(1, "基础", 9, 2, null, 0),
            CancellationToken.None);

        var ex = await act.ShouldThrowAsync<BusinessRuleException>();
        ex.Message.ShouldContain("没有层级关系");
    }

    [Fact]
    public async Task 修改标签_成功更新名称与层级()
    {
        var tag = WithId(Tag.Create("math", "高等数学", TagGroup.Domain, null, null, 0, Now), 1);
        var parent = WithId(Tag.Create("math.calc", "微积分", TagGroup.Domain, null, null, 0, Now), 2);

        _tags.GetByIdAsync(1, Arg.Any<CancellationToken>()).Returns(tag);
        _tags.GetByIdAsync(2, Arg.Any<CancellationToken>()).Returns(parent);
        _tags.GetDescendantIdsAsync(Arg.Any<long>(), Arg.Any<bool>(), Arg.Any<CancellationToken>())
            .Returns(new long[] { 1 });

        var result = await UpdateHandler().Handle(
            new UpdateTagCommand(1, "高等数学A", 2, null, "说明", 5),
            CancellationToken.None);

        result.Name.ShouldBe("高等数学A");
        result.ParentId.ShouldBe(2);
        result.Description.ShouldBe("说明");
        result.SortOrder.ShouldBe(5);
    }

    [Fact]
    public async Task 删除标签_存在子标签时拒绝()
    {
        var tag = Tag.Create("math", "高等数学", TagGroup.Domain, null, null, 0, Now);
        _tags.GetByIdAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns(tag);
        _tags.CountChildrenAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns(1);

        var act = async () => await DeleteHandler().Handle(new DeleteTagCommand(1), CancellationToken.None);

        var ex = await act.ShouldThrowAsync<TagInUseException>();
        ex.ErrorCode.ShouldBe(ErrorCodes.TagInUse);
    }

    [Fact]
    public async Task 删除标签_无引用时软删除()
    {
        var tag = Tag.Create("math", "高等数学", TagGroup.Domain, null, null, 0, Now);
        _tags.GetByIdAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns(tag);
        _tags.CountChildrenAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns(0);

        await DeleteHandler().Handle(new DeleteTagCommand(1), CancellationToken.None);

        tag.IsDeleted.ShouldBeTrue();
        _tags.Received(1).Update(tag);
    }

    [Fact]
    public async Task 标签列表_按维度分组返回()
    {
        _tags.ListAsync(Arg.Any<TagGroup?>(), Arg.Any<CancellationToken>()).Returns(new[]
        {
            Tag.Create("math", "高等数学", TagGroup.Domain, null, null, 0, Now),
            Tag.Create("d1", "基础", TagGroup.Difficulty, 1, null, 0, Now),
        });

        var result = await new GetTagsHandler(_tags)
            .Handle(new GetTagsQuery(null), CancellationToken.None);

        result.Groups.Count.ShouldBe(2);
        result.Groups[0].Group.ShouldBe("domain");
        result.Groups[0].AllowsHierarchy.ShouldBeTrue();
        result.Groups[0].AppliesToQuestions.ShouldBeTrue();
        result.Groups[0].AppliesToUsers.ShouldBeFalse();
        result.Groups[1].Group.ShouldBe("difficulty");
        result.Groups[1].AllowsHierarchy.ShouldBeFalse();
    }

    [Fact]
    public async Task 标签后代_包含自身时可命中全部子孙()
    {
        var root = WithId(Tag.Create("math", "高等数学", TagGroup.Domain, null, null, 0, Now), 1);
        _tags.GetByIdAsync(1, Arg.Any<CancellationToken>()).Returns(root);
        _tags.GetDescendantIdsAsync(1, true, Arg.Any<CancellationToken>()).Returns(new long[] { 1, 2, 3 });
        _tags.GetByIdsAsync(Arg.Any<IReadOnlyCollection<long>>(), Arg.Any<CancellationToken>())
            .Returns(new[] { root });

        var result = await new GetTagDescendantsHandler(_tags)
            .Handle(new GetTagDescendantsQuery(1, true), CancellationToken.None);

        result.Ids.ShouldBe(new long[] { 1, 2, 3 });
    }
}
