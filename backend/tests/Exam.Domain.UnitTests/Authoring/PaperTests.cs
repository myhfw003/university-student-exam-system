using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Authoring;

public sealed class PaperTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 6, 0, 0, TimeSpan.Zero);

    private static Question PublishedQuestion(long id = 1, string code = "Q-1")
    {
        var question = Question.CreateDraft(code, QuestionType.Single, "题干", Score.Question(5), 30, Now);
        typeof(Exam.Domain.SharedKernel.Entities.Entity<long>)
            .GetProperty(nameof(Exam.Domain.SharedKernel.Entities.Entity<long>.Id))!
            .SetValue(question, id);

        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), Now);
        question.Publish(Now);
        return question;
    }

    private static Question DraftQuestion(long id = 2)
    {
        var question = Question.CreateDraft("Q-2", QuestionType.Single, "题干", Score.Question(5), 30, Now);
        typeof(Exam.Domain.SharedKernel.Entities.Entity<long>)
            .GetProperty(nameof(Exam.Domain.SharedKernel.Entities.Entity<long>.Id))!
            .SetValue(question, id);
        return question;
    }

    [Fact]
    public void 新建试卷是草稿且形态决定默认规则()
    {
        var exam = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);
        var practice = Paper.CreateDraft(PaperKind.Practice, "专项练习", Now);

        exam.Status.ShouldBe(PaperStatus.Draft);
        exam.ExamRules.ShouldNotBeNull();
        exam.PracticeRules.ShouldBeNull();

        practice.ExamRules.ShouldBeNull();
        practice.PracticeRules.ShouldNotBeNull();
    }

    [Fact]
    public void 试卷名称不能为空()
    {
        var act = () => Paper.CreateDraft(PaperKind.Exam, "  ", Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 只有已发布题目能入卷()
    {
        var paper = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);

        var act = () => paper.AddItem(DraftQuestion(), Score.Question(5), 0, Now);

        var ex = act.ShouldThrow<BusinessRuleException>();
        ex.Message.ShouldContain("已发布");
    }

    [Fact]
    public void 同一道题不能重复入卷()
    {
        var paper = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);
        var question = PublishedQuestion();

        paper.AddItem(question, Score.Question(5), 0, Now);

        var act = () => paper.AddItem(question, Score.Question(5), 1, Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 题位分值之和可计算()
    {
        var paper = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);
        paper.AddItem(PublishedQuestion(1), Score.Question(5), 0, Now);
        paper.AddItem(PublishedQuestion(2, "Q-2"), Score.Question(7.5m), 1, Now);

        paper.TotalItemScore.ShouldBe(12.5m);
        paper.Items.Count.ShouldBe(2);
    }

    [Fact]
    public void 已发布试卷的题位不可改()
    {
        var paper = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);
        paper.AddItem(PublishedQuestion(), Score.Question(5), 0, Now);
        paper.Publish(null, Now);

        var act = () => paper.AddItem(PublishedQuestion(2, "Q-2"), Score.Question(5), 1, Now);

        var ex = act.ShouldThrow<PaperImmutableException>();
        ex.ErrorCode.ShouldBe(ErrorCodes.PaperImmutable);
    }

    [Fact]
    public void 发布后可撤回再发布()
    {
        var paper = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);
        paper.AddItem(PublishedQuestion(), Score.Question(5), 0, Now);

        paper.Publish(null, Now);
        paper.Status.ShouldBe(PaperStatus.Published);

        paper.Unpublish(Now);
        paper.Status.ShouldBe(PaperStatus.Draft);

        paper.Publish(null, Now);
        paper.Status.ShouldBe(PaperStatus.Published);
    }

    [Fact]
    public void 只有已发布试卷能撤回()
    {
        var paper = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);

        var act = () => paper.Unpublish(Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 考试卷不能设置练习规则且反之亦然()
    {
        var exam = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);
        var practice = Paper.CreateDraft(PaperKind.Practice, "专项练习", Now);

        var act1 = () => exam.SetPracticeRules(PracticeRules.Default, Now);
        var act2 = () => practice.SetExamRules(ExamRules.Default, Now);

        act1.ShouldThrow<BusinessRuleException>();
        act2.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 标签数量上限为五个()
    {
        var paper = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);

        for (var i = 1; i <= 5; i++)
        {
            paper.AttachTag(i, Now);
        }

        var act = () => paper.AttachTag(6, Now);
        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 归档试卷()
    {
        var paper = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);

        paper.Archive(Now);

        paper.Status.ShouldBe(PaperStatus.Archived);
    }
}
