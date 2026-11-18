using Exam.Application.Catalog.Services;
using Exam.Application.Common.Interfaces;
using Exam.Application.UnitTests.Identity;
using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Abstractions;
using NSubstitute;
using Shouldly;

namespace Exam.Application.UnitTests.Catalog;

public sealed class OrganizationTagProvisionerTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 18, 1, 0, 0, TimeSpan.Zero);

    private readonly ITagRepository _tags = Substitute.For<ITagRepository>();
    private readonly IUnitOfWork _unitOfWork = Substitute.For<IUnitOfWork>();
    private readonly IClock _clock = new FixedClock(Now);
    private readonly ICurrentUser _currentUser = Substitute.For<ICurrentUser>();

    private OrganizationTagProvisioner Provisioner() =>
        new(_tags, _unitOfWork, _clock, _currentUser);

    [Fact]
    public async Task 班级名带空格时编码里的空格换成中划线()
    {
        _tags.GetByParentAndNameAsync(Arg.Any<long?>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((Tag?)null);
        _tags.GetByCodeAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((Tag?)null);

        var tag = await Provisioner().EnsureAsync(null, "计科 2301 班", CancellationToken.None);

        // 名字保留原样；编码要落在允许的字符集里，否则整行名单都会被判非法编码。
        tag.Name.ShouldBe("计科 2301 班");
        tag.Code.ShouldBe("org.计科-2301-班");
    }

    [Fact]
    public async Task 同一父节点下的同名标签直接复用()
    {
        var existing = Tag.Create(
            "org.计算机学院", "计算机学院", TagGroup.Organization, null, null, 0, Now);
        _tags.GetByParentAndNameAsync(null, "计算机学院", Arg.Any<CancellationToken>())
            .Returns(existing);

        var tag = await Provisioner().EnsureAsync(null, "计算机学院", CancellationToken.None);

        tag.ShouldBeSameAs(existing);
        await _tags.DidNotReceive().AddAsync(Arg.Any<Tag>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task 编码重复时补后缀()
    {
        _tags.GetByParentAndNameAsync(Arg.Any<long?>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((Tag?)null);
        _tags.GetByCodeAsync("org.计算机学院", Arg.Any<CancellationToken>())
            .Returns(Tag.Create("org.计算机学院", "计算机学院", TagGroup.Organization, null, null, 0, Now));

        var tag = await Provisioner().EnsureAsync(null, "计算机学院", CancellationToken.None);

        tag.Code.ShouldBe("org.计算机学院-2");
    }
}
