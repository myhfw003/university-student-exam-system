using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Shouldly;

namespace Exam.Domain.UnitTests.Authoring;

public sealed class PaperPublicationValidatorTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 6, 0, 0, TimeSpan.Zero);

    private static Paper NewPaper(decimal targetScore = 10m, int durationMinutes = 60)
    {
        var paper = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);
        paper.UpdateMeta(
            "期末考试",
            null,
            null,
            Score.Paper(targetScore),
            durationMinutes,
            null,
            null,
            Now);

        return paper;
    }

    private static Question PublishedQuestion(long id, QuestionType type = QuestionType.Single)
    {
        var question = Question.CreateDraft($"Q-{id}", type, "题干", Score.Question(5), 30, Now);
        typeof(Exam.Domain.SharedKernel.Entities.Entity<long>)
            .GetProperty(nameof(Exam.Domain.SharedKernel.Entities.Entity<long>.Id))!
            .SetValue(question, id);

        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), Now);

        if (type == QuestionType.Short)
        {
            question.AddKeypoint(QuestionKeypoint.Create("要点", [], 0), Now);
        }

        question.Publish(Now);
        return question;
    }

    private static IReadOnlyList<ValidationItem> Validate(
        Paper paper,
        IEnumerable<long>? questionIds = null,
        IReadOnlySet<long>? subjective = null,
        bool rosterConfigured = true)
    {
        var ids = (questionIds ?? paper.Items.Select(i => i.QuestionId)).Distinct().ToList();
        var statuses = ids.ToDictionary(id => id, _ => "published");

        return new PaperPublicationValidator().Validate(
            paper,
            statuses,
            subjective ?? new HashSet<long>(),
            rosterConfigured);
    }

    [Fact]
    public void 空试卷_数量校验不通过()
    {
        var items = Validate(NewPaper());

        var count = items.Single(i => i.Key == "count");
        count.Passed.ShouldBeFalse();
        count.Severity.ShouldBe(ValidationSeverity.Blocking);
    }

    [Fact]
    public void 题位分值之和与目标总分不一致_校验不通过()
    {
        var paper = NewPaper(targetScore: 10m);
        paper.AddItem(PublishedQuestion(1), Score.Question(5), 0, Now);

        var score = Validate(paper).Single(i => i.Key == "score");
        score.Passed.ShouldBeFalse();
        score.Detail.ShouldNotBeNull();
        score.Detail!.ShouldContain("不一致");
    }

    [Fact]
    public void 题目不是已发布状态_校验不通过并定位到题目()
    {
        var paper = NewPaper(targetScore: 5m);
        paper.AddItem(PublishedQuestion(1), Score.Question(5), 0, Now);

        var items = new PaperPublicationValidator().Validate(
            paper,
            new Dictionary<long, string> { [1] = "draft" },
            new HashSet<long>(),
            rosterConfigured: true);

        var published = items.Single(i => i.Key == "published");
        published.Passed.ShouldBeFalse();
        published.Targets.ShouldContain(1L);
    }

    [Fact]
    public void 主观题占比过高只警告不阻断()
    {
        var paper = NewPaper(targetScore: 10m, durationMinutes: 60);
        paper.AddItem(PublishedQuestion(1, QuestionType.Short), Score.Question(8), 0, Now);
        paper.AddItem(PublishedQuestion(2), Score.Question(2), 1, Now);

        var items = new PaperPublicationValidator().Validate(
            paper,
            new Dictionary<long, string> { [1] = "published", [2] = "published" },
            new HashSet<long> { 1 },
            rosterConfigured: true);

        var ratio = items.Single(i => i.Key == "subjectiveRatio");
        ratio.Passed.ShouldBeFalse();
        ratio.Severity.ShouldBe(ValidationSeverity.Warning);
    }

    [Fact]
    public void 考试卷名单未配置_阻断()
    {
        var paper = NewPaper(targetScore: 5m);
        paper.AddItem(PublishedQuestion(1), Score.Question(5), 0, Now);

        var roster = Validate(paper, rosterConfigured: false).Single(i => i.Key == "roster");
        roster.Passed.ShouldBeFalse();
        roster.Severity.ShouldBe(ValidationSeverity.Blocking);
    }

    [Fact]
    public void 练习卷豁免名单校验()
    {
        var paper = Paper.CreateDraft(PaperKind.Practice, "专项练习", Now);
        paper.UpdateMeta("专项练习", null, null, Score.Paper(5m), 60, null, null, Now);
        paper.AddItem(PublishedQuestion(1), Score.Question(5), 0, Now);

        var roster = Validate(paper, rosterConfigured: false).Single(i => i.Key == "roster");
        roster.Passed.ShouldBeTrue();
    }

    [Fact]
    public void 时长明显不匹配_警告()
    {
        // 1 道题 300 分钟：题均远超建议区间。
        var paper = NewPaper(targetScore: 5m, durationMinutes: 300);
        paper.AddItem(PublishedQuestion(1), Score.Question(5), 0, Now);

        var duration = Validate(paper).Single(i => i.Key == "durationFit");
        duration.Passed.ShouldBeFalse();
        duration.Severity.ShouldBe(ValidationSeverity.Warning);
    }

    [Fact]
    public void 校验共八项()
    {
        var paper = NewPaper(targetScore: 5m);
        paper.AddItem(PublishedQuestion(1), Score.Question(5), 0, Now);

        Validate(paper).Count.ShouldBe(8);
    }
}
