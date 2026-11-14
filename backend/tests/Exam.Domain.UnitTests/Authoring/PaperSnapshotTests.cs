using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Entities;
using Shouldly;

namespace Exam.Domain.UnitTests.Authoring;

public sealed class PaperSnapshotTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 6, 0, 0, TimeSpan.Zero);

    private static Question PublishedQuestion(long id = 1, string code = "Q-1", string stem = "原始题干")
    {
        var question = Question.CreateDraft(code, QuestionType.Single, stem, Score.Question(5), 30, Now);
        typeof(Entity<long>)
            .GetProperty(nameof(Entity<long>.Id))!
            .SetValue(question, id);

        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), Now);
        question.Publish(Now);
        return question;
    }

    private static Paper PaperWith(Question question, decimal score = 5m)
    {
        var paper = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);
        paper.AddItem(question, Score.Question(score), 0, Now);
        return paper;
    }

    [Fact]
    public void 快照冻结题目内容_之后改题不影响快照()
    {
        var question = PublishedQuestion();
        var paper = PaperWith(question);

        var snapshot = PaperSnapshot.Create(paper, [question], 1, Now);

        question.UpdateContent("改过的题干", null, null, Score.Question(5), Now);

        snapshot.Items.Count.ShouldBe(1);
        snapshot.Items.Single().Stem.ShouldBe("原始题干");
    }

    [Fact]
    public void 快照记录正确答案与选项()
    {
        var question = PublishedQuestion();
        var paper = PaperWith(question);

        var snapshot = PaperSnapshot.Create(paper, [question], 1, Now);

        var item = snapshot.Items.Single();
        item.CorrectKeys.ShouldBe(["A"]);
        item.Options.Select(o => o.Key).ShouldBe(["A", "B"]);
        item.QuestionType.ShouldBe("single");
        item.Score.Value.ShouldBe(5m);
    }

    [Fact]
    public void 快照只包含已入卷的题目()
    {
        var question = PublishedQuestion(1, "Q-1");
        var other = PublishedQuestion(2, "Q-2");
        var paper = PaperWith(question);

        var snapshot = PaperSnapshot.Create(paper, [question, other], 1, Now);

        snapshot.Items.Count.ShouldBe(1);
        snapshot.Items.Single().QuestionId.ShouldBe(1);
    }

    [Fact]
    public void 相同内容的内容哈希一致()
    {
        var question = PublishedQuestion();
        var paper = PaperWith(question);

        var first = PaperSnapshot.Create(paper, [question], 1, Now);
        var second = PaperSnapshot.Create(paper, [question], 2, Now);

        second.ContentHash.ShouldBe(first.ContentHash);
    }

    [Fact]
    public void 内容变化后内容哈希变化()
    {
        var question = PublishedQuestion();
        var paper = PaperWith(question);
        var before = PaperSnapshot.Create(paper, [question], 1, Now);

        question.UpdateContent("换了一道题", null, null, Score.Question(5), Now);
        var after = PaperSnapshot.Create(paper, [question], 2, Now);

        after.ContentHash.ShouldNotBe(before.ContentHash);
    }

    [Fact]
    public void 快照版本号按传入值记录()
    {
        var question = PublishedQuestion();
        var paper = PaperWith(question);

        var snapshot = PaperSnapshot.Create(paper, [question], 3, Now);

        snapshot.SnapshotVersion.ShouldBe(3);
        snapshot.PaperId.ShouldBe(paper.Id);
    }
}
