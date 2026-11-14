using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.Delivery;
using Exam.Domain.Grading;
using Exam.Domain.SharedKernel.Entities;
using Shouldly;

namespace Exam.Domain.UnitTests.Grading;

public sealed class ScoringStrategyTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 6, 0, 0, TimeSpan.Zero);

    private static Question Single(string code = "Q-1")
    {
        var question = Question.CreateDraft(code, QuestionType.Single, "题干", Score.Question(10), 30, Now);
        typeof(Entity<long>).GetProperty(nameof(Entity<long>.Id))!.SetValue(question, 1);
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), Now);
        question.Publish(Now);
        return question;
    }

    private static Question Multi(string code = "Q-M")
    {
        var question = Question.CreateDraft(code, QuestionType.Multi, "题干", Score.Question(10), 30, Now);
        typeof(Entity<long>).GetProperty(nameof(Entity<long>.Id))!.SetValue(question, 2);
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), Now);
        question.AddOption(QuestionOption.Create("C", "丙", true, 2), Now);
        question.AddOption(QuestionOption.Create("D", "丁", true, 3), Now);
        question.Publish(Now);
        return question;
    }

    private static Question Judge(string code = "Q-J")
    {
        var question = Question.CreateDraft(code, QuestionType.Judge, "题干", Score.Question(5), 30, Now);
        typeof(Entity<long>).GetProperty(nameof(Entity<long>.Id))!.SetValue(question, 3);
        question.Publish(Now);
        return question;
    }

    private static Question Short(string code = "Q-S")
    {
        var question = Question.CreateDraft(code, QuestionType.Short, "题干", Score.Question(10), 30, Now);
        typeof(Entity<long>).GetProperty(nameof(Entity<long>.Id))!.SetValue(question, 4);
        question.AddKeypoint(QuestionKeypoint.Create("三次握手", ["三次", "握手"], 0), Now);
        question.AddKeypoint(QuestionKeypoint.Create("四次挥手", ["四次", "挥手"], 1), Now);
        question.Publish(Now);
        return question;
    }

    private static Question Comprehensive(string code = "Q-C")
    {
        var question = Question.CreateDraft(code, QuestionType.Comprehensive, "题干", Score.Question(10), 30, Now);
        typeof(Entity<long>).GetProperty(nameof(Entity<long>.Id))!.SetValue(question, 5);
        question.AddStep(QuestionStep.Create("S1", "第一步", "建立连接", ["建立", "连接"], Score.Question(6), 0), Now);
        question.AddStep(QuestionStep.Create("S2", "第二步", "释放连接", ["释放", "连接"], Score.Question(4), 1), Now);
        question.Publish(Now);
        return question;
    }

    private static PaperItem Item(decimal score = 10m) => PaperItem.Create(1, Score.Question(score), 0);

    private static SnapshotItem Snapshot(Question question, decimal score = 10m) =>
        SnapshotItem.Create(question, Score.Question(score), 0, null, Now);

    [Fact]
    public void 单选答对得满分()
    {
        var question = Single();

        var outcome = ScoringStrategies.For(QuestionType.Single)
            .Score(AnswerPayload.Options("A"), Item(), Snapshot(question));

        outcome.Score.ShouldBe(10m);
        outcome.MaxScore.ShouldBe(10m);
        outcome.Method.ShouldBe(ScoringMethod.AutoScored);
        outcome.Status.ShouldBe(ScoringStatus.AutoScored);
    }

    [Fact]
    public void 单选答错得零分()
    {
        var question = Single();

        var outcome = ScoringStrategies.For(QuestionType.Single)
            .Score(AnswerPayload.Options("B"), Item(), Snapshot(question));

        outcome.Score.ShouldBe(0m);
    }

    [Fact]
    public void 单选未作答得零分()
    {
        var question = Single();

        var outcome = ScoringStrategies.For(QuestionType.Single)
            .Score(AnswerPayload.Empty(), Item(), Snapshot(question));

        outcome.Score.ShouldBe(0m);
        outcome.Details.ShouldContain("未作答");
    }

    [Fact]
    public void 判断题比较原始选项键()
    {
        var question = Judge();

        var outcome = ScoringStrategies.For(QuestionType.Judge)
            .Score(AnswerPayload.Options("A"), Item(5m), Snapshot(question, 5m));

        outcome.Score.ShouldBe(5m);
    }

    [Fact]
    public void 多选全对得满分()
    {
        var question = Multi();

        var outcome = ScoringStrategies.For(QuestionType.Multi)
            .Score(AnswerPayload.Options("A", "C", "D"), Item(), Snapshot(question));

        outcome.Score.ShouldBe(10m);
    }

    [Fact]
    public void 多选错选得零分()
    {
        var question = Multi();

        var outcome = ScoringStrategies.For(QuestionType.Multi)
            .Score(AnswerPayload.Options("A", "B", "C", "D"), Item(), Snapshot(question));

        outcome.Score.ShouldBe(0m);
        outcome.Details.ShouldContain(d => d.Contains("错选"));
    }

    [Fact]
    public void 多选漏选按命中比例折半()
    {
        var question = Multi();

        // 命中 1/3：10 × 1/3 × 0.5 = 1.67，按 0.5 步进取整为 1.5。
        var outcome = ScoringStrategies.For(QuestionType.Multi)
            .Score(AnswerPayload.Options("A"), Item(), Snapshot(question));

        outcome.Score.ShouldBe(1.5m);
        outcome.Details.ShouldContain(d => d.Contains("命中 1/3"));
    }

    [Fact]
    public void 简答要点关键词全部命中才算该要点得分()
    {
        var question = Short();

        var outcome = ScoringStrategies.For(QuestionType.Short)
            .Score(AnswerPayload.Written("TCP 三次握手用于建立连接，四次挥手用于释放连接。"), Item(), Snapshot(question));

        outcome.Score.ShouldBe(10m);
        outcome.Method.ShouldBe(ScoringMethod.AutoSuggested);
        outcome.Status.ShouldBe(ScoringStatus.Suggested);
    }

    [Fact]
    public void 简答只命中一个要点得一半分()
    {
        var question = Short();

        var outcome = ScoringStrategies.For(QuestionType.Short)
            .Score(AnswerPayload.Written("我记得是三次握手。"), Item(), Snapshot(question));

        outcome.Score.ShouldBe(5m);
    }

    [Fact]
    public void 关键词匹配忽略大小写与全半角()
    {
        var question = Short();

        var outcome = ScoringStrategies.For(QuestionType.Short)
            .Score(AnswerPayload.Written("ＴＣＰ　三次握手、四次挥手"), Item(), Snapshot(question));

        outcome.Score.ShouldBe(10m);
    }

    [Fact]
    public void 综合题按命中步骤分占比折算()
    {
        var question = Comprehensive();

        var outcome = ScoringStrategies.For(QuestionType.Comprehensive)
            .Score(
                AnswerPayload.StepAnswers(
                [
                    new AnswerStep("S1", "先建立连接"),
                    new AnswerStep("S2", "再释放连接"),
                ]),
                Item(),
                Snapshot(question));

        outcome.Score.ShouldBe(10m);
        outcome.Status.ShouldBe(ScoringStatus.Suggested);
    }

    [Fact]
    public void 综合题只命中第一步得六分()
    {
        var question = Comprehensive();

        var outcome = ScoringStrategies.For(QuestionType.Comprehensive)
            .Score(
                AnswerPayload.StepAnswers(
                [
                    new AnswerStep("S1", "先建立连接"),
                    new AnswerStep("S2", "我不知道"),
                ]),
                Item(),
                Snapshot(question));

        outcome.Score.ShouldBe(6m);
        outcome.Details.ShouldContain("✓ S1");
        outcome.Details.ShouldContain("○ S2");
    }

    [Fact]
    public void 归一化会去掉空白与标点()
    {
        AnswerTextNormalizer.Normalize("  你 好，世界！ ").ShouldBe("你好世界");
        AnswerTextNormalizer.Contains("Hello, World!", "helloworld").ShouldBeTrue();
        AnswerTextNormalizer.ContainsAll("TCP三次握手", ["三次", "握手"]).ShouldBeTrue();
        AnswerTextNormalizer.ContainsAll("TCP三次握手", ["三次", "挥手"]).ShouldBeFalse();
    }
}
