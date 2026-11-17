using Exam.Application.Common.Interfaces;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Services;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Entities;
using NSubstitute;
using Shouldly;

namespace Exam.Application.UnitTests.Delivery;

/// <summary>
/// 考生卷面构建。
/// <para>
/// 卷面是考试期间唯一下发到考生手里的东西：
/// 步骤与标签要给全（否则综合题没法作答、题头没有标签），
/// 参考答案与关键词一个都不能给（给了等于泄题）。
/// </para>
/// </summary>
public sealed class AttemptPaperSurfaceBuilderTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 17, 1, 0, 0, TimeSpan.Zero);

    private const long DifficultyTagId = 900;
    private const long KnowledgeTagId = 901;
    private const long StudentId = 42;
    private const string SessionSeed = "7";

    private readonly IQuestionRepository _questions = Substitute.For<IQuestionRepository>();
    private readonly ITagRepository _tags = Substitute.For<ITagRepository>();
    private readonly IPaperSnapshotRepository _snapshots = Substitute.For<IPaperSnapshotRepository>();

    private AttemptPaperSurfaceBuilder Builder() =>
        new(
            _snapshots,
            _questions,
            _tags,
            // 解析器是 sealed 类，只能用真身；按快照建卷面这条路不会碰它。
            new AttemptPaperResolver(
                Substitute.For<IExamSessionRepository>(),
                Substitute.For<IPracticeAssignmentRepository>(),
                Substitute.For<IPaperRepository>(),
                Substitute.For<IPaperSnapshotRepository>()));

    /// <summary>给实体赋主键，模拟已持久化。</summary>
    private static T WithId<T>(T entity, long id)
        where T : class
    {
        typeof(Entity<long>).GetProperty(nameof(Entity<long>.Id))!.SetValue(entity, id);
        return entity;
    }

    private static Tag DifficultyTag() =>
        WithId(
            Tag.Create("difficulty.base", "基础", TagGroup.Difficulty, 1, null, 0, Now),
            DifficultyTagId);

    private static Question SingleQuestion(long id)
    {
        var question = Question.CreateDraft(
            "Q-SINGLE",
            QuestionType.Single,
            "单选题题干",
            Score.Question(10m),
            DifficultyTagId,
            Now);

        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), Now);
        question.AddOption(QuestionOption.Create("C", "丙", false, 2), Now);
        question.AttachTag(KnowledgeTagId, Now);
        question.Publish(Now);

        return WithId(question, id);
    }

    private static Question ComprehensiveQuestion(long id)
    {
        var question = Question.CreateDraft(
            "Q-COMP",
            QuestionType.Comprehensive,
            "综合题题干",
            Score.Question(10m),
            DifficultyTagId,
            Now);

        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), Now);
        question.AddStep(
            QuestionStep.Create("S1", "第一步：说明理由", "参考答案一", ["理由"], Score.Question(4m), 0),
            Now);
        question.AddStep(
            QuestionStep.Create("S2", "第二步：给出结论", "参考答案二", ["结论"], Score.Question(6m), 1),
            Now);
        question.AttachTag(KnowledgeTagId, Now);
        question.Publish(Now);

        return WithId(question, id);
    }

    private static PaperSnapshot SnapshotOf(Question question)
    {
        var paper = Paper.CreateDraft(PaperKind.Exam, "单元测试卷", Now);
        paper.AddItem(question, Score.Question(10m), 0, Now);
        return PaperSnapshot.Create(paper, [question], 1, Now);
    }

    private void StubRepositories(params Question[] questions)
    {
        _questions.GetByIdsAsync(Arg.Any<IReadOnlyCollection<long>>(), Arg.Any<CancellationToken>())
            .Returns(questions);
        _tags.GetByIdsAsync(Arg.Any<IReadOnlyCollection<long>>(), Arg.Any<CancellationToken>())
            .Returns([DifficultyTag()]);
    }

    [Fact]
    public async Task 卷面带出综合题步骤_但不下发参考答案与关键词()
    {
        var question = ComprehensiveQuestion(501);
        StubRepositories(question);

        var surface = await Builder().BuildAsync(
            SnapshotOf(question),
            VariantRule.Standard,
            StudentId,
            SessionSeed);

        var dto = surface.Questions.ShouldHaveSingleItem();
        dto.Steps.Count.ShouldBe(2);
        dto.Steps[0].Code.ShouldBe("S1");
        dto.Steps[0].Prompt.ShouldBe("第一步：说明理由");
        dto.Steps[0].Score.ShouldBe(4m);
        dto.Steps[1].Code.ShouldBe("S2");
        dto.Steps[1].Score.ShouldBe(6m);

        // 参考答案与关键词属于判分依据：DTO 上不允许出现这两个属性。
        typeof(AttemptStepDto).GetProperty("ReferenceAnswer").ShouldBeNull();
        typeof(AttemptStepDto).GetProperty("Keywords").ShouldBeNull();
    }

    [Fact]
    public async Task 卷面带出题目标签与难度标签()
    {
        var question = SingleQuestion(502);
        StubRepositories(question);

        var surface = await Builder().BuildAsync(
            SnapshotOf(question),
            VariantRule.Standard,
            StudentId,
            SessionSeed);

        var dto = surface.Questions.ShouldHaveSingleItem();
        dto.TagIds.ShouldContain(KnowledgeTagId);
        dto.DifficultyTagId.ShouldBe(DifficultyTagId);
        dto.Difficulty.ShouldBe("基础");
    }

    [Fact]
    public async Task 选项按考生置换顺序给出_键仍是原题键()
    {
        var question = SingleQuestion(503);
        StubRepositories(question);
        var snapshot = SnapshotOf(question);

        var surface = await Builder().BuildAsync(
            snapshot,
            VariantRule.SmallPlum,
            StudentId,
            SessionSeed);

        // 以领域服务为基准：卷面的选项顺序必须与派生器给出的一致。
        var expected = PaperVariantBuilder.Build(
            snapshot,
            VariantRule.SmallPlum,
            StudentId.ToString(),
            SessionSeed);

        var dto = surface.Questions.ShouldHaveSingleItem();
        dto.Options.Select(o => o.Key).ShouldBe(expected.Items[0].OptionOrder);

        // 键仍然是原题键（不是显示字母），且键与选项文本始终对应。
        dto.Options.Single(o => o.Key == "A").Text.ShouldBe("甲");
        dto.Options.Single(o => o.Key == "B").Text.ShouldBe("乙");
        dto.Options.Single(o => o.Key == "C").Text.ShouldBe("丙");
    }

    [Fact]
    public async Task 标准卷不置换选项()
    {
        var question = SingleQuestion(504);
        StubRepositories(question);

        var surface = await Builder().BuildAsync(
            SnapshotOf(question),
            VariantRule.Standard,
            StudentId,
            SessionSeed);

        var dto = surface.Questions.ShouldHaveSingleItem();
        dto.Options.Select(o => o.Key).ShouldBe(["A", "B", "C"]);
    }
}
