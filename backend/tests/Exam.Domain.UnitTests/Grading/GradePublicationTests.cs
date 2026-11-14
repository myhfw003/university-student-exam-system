using Exam.Domain.Grading;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Grading;

/// <summary>
/// 成绩发布的规则。
/// <para>
/// 一次发布只覆盖名单里的作答；名单外的照旧不发。
/// </para>
/// </summary>
public sealed class GradePublicationTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 6, 0, 0, TimeSpan.Zero);

    [Fact]
    public void 发布覆盖名单里的作答()
    {
        var publication = GradePublication.Create(
            examSessionId: 30,
            scope: GradePublicationScope.All,
            includedAttemptIds: [101, 102],
            now: Now,
            publisherId: 7);

        publication.ExamSessionId.ShouldBe(30);
        publication.Scope.ShouldBe(GradePublicationScope.All);
        publication.PublishedBy.ShouldBe(7);
        publication.PublishedAt.ShouldBe(Now);
        publication.IncludedAttemptIds.Count.ShouldBe(2);
    }

    [Fact]
    public void 名单外的作答不覆盖()
    {
        var publication = GradePublication.Create(
            examSessionId: 30,
            scope: GradePublicationScope.All,
            includedAttemptIds: [101],
            now: Now,
            publisherId: 7);

        publication.Covers(101).ShouldBeTrue();
        publication.Covers(102).ShouldBeFalse();
    }

    [Fact]
    public void 名单去重()
    {
        var publication = GradePublication.Create(
            examSessionId: 30,
            scope: GradePublicationScope.ObjectiveOnly,
            includedAttemptIds: [101, 101, 102],
            now: Now,
            publisherId: 7);

        publication.IncludedAttemptIds.Count.ShouldBe(2);
    }

    [Fact]
    public void 场次不合法被拒绝()
    {
        var act = () => GradePublication.Create(
            examSessionId: 0,
            scope: GradePublicationScope.All,
            includedAttemptIds: [101],
            now: Now,
            publisherId: 7);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 作答会话不合法被拒绝()
    {
        var act = () => GradePublication.Create(
            examSessionId: 30,
            scope: GradePublicationScope.All,
            includedAttemptIds: [0],
            now: Now,
            publisherId: 7);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 发布范围有中文标签与存储值()
    {
        GradePublicationScope.All.ToStorage().ShouldBe("all");
        GradePublicationScope.All.Label().ShouldBe("全部成绩");
        GradePublicationScope.ObjectiveOnly.ToStorage().ShouldBe("objective_only");
        GradePublicationScope.ObjectiveOnly.Label().ShouldBe("仅客观题");
    }
}
