using Exam.Application.Catalog.Services;
using Exam.Domain.Catalog;
using Shouldly;

namespace Exam.Application.UnitTests.Catalog;

/// <summary>
/// AI 生成请求的校验规则。
/// <para>
/// 这份规则是**流式与非流式两个入口共用**的，也是界面上那几条前置拦截的
/// 依据——两边说的必须是同一件事。
/// </para>
/// <para>
/// 2026-11-26 公测机上老师把「生成数量」填出了服务端允许的范围，服务端
/// 按「一次最多 10 道题」拒了（HTTP 400），而界面上那一条规则与输入框
/// 上限对不上，老师不知道自己被哪儿拒了。这份规则本身是对的，错的是
/// **界面上没有跟它对齐**，所以这里把每条规则的边界与文案都钉住。
/// </para>
/// </summary>
public sealed class AiGenerationRequestRulesTests
{
    [Fact]
    public void 合法的请求没有错误()
    {
        var errors = AiGenerationRequestRules.Validate(
            provider: "minimax",
            count: 3,
            type: "single",
            difficultyTagId: 1,
            tagIds: [1, 2],
            prompt: "围绕 TCP 三次握手出题");

        errors.ShouldBeEmpty();
    }

    [Fact]
    public void 生成数量超过上限时报出上限()
    {
        var errors = AiGenerationRequestRules.Validate(
            provider: "minimax",
            count: AiGenerationRequestRules.MaxCount + 1,
            type: "single",
            difficultyTagId: 1,
            tagIds: [],
            prompt: "出题");

        errors.ShouldContainKey("Count");
        errors["Count"].ShouldContain($"一次最多生成 {AiGenerationRequestRules.MaxCount} 道题。");
    }

    [Fact]
    public void 生成数量正好等于上限时放行()
    {
        var errors = AiGenerationRequestRules.Validate(
            provider: "minimax",
            count: AiGenerationRequestRules.MaxCount,
            type: "single",
            difficultyTagId: 1,
            tagIds: [],
            prompt: "出题");

        errors.ShouldNotContainKey("Count");
    }

    [Fact]
    public void 生成数量为零也拒()
    {
        var errors = AiGenerationRequestRules.Validate(
            provider: "minimax",
            count: 0,
            type: "single",
            difficultyTagId: 1,
            tagIds: [],
            prompt: "出题");

        errors.ShouldContainKey("Count");
    }

    [Fact]
    public void 出题要求为空时报出提示()
    {
        var errors = AiGenerationRequestRules.Validate(
            provider: "minimax",
            count: 3,
            type: "single",
            difficultyTagId: 1,
            tagIds: [],
            prompt: "   ");

        errors.ShouldContainKey("Prompt");
        errors["Prompt"].ShouldContain("请填写出题要求。");
    }

    [Fact]
    public void 出题要求过长时报出提示()
    {
        var errors = AiGenerationRequestRules.Validate(
            provider: "minimax",
            count: 3,
            type: "single",
            difficultyTagId: 1,
            tagIds: [],
            prompt: new string('x', AiGenerationRequestRules.MaxPromptLength + 1));

        errors.ShouldContainKey("Prompt");
        errors["Prompt"].ShouldContain("出题要求过长。");
    }

    [Fact]
    public void 出题要求正好等于上限时放行()
    {
        var errors = AiGenerationRequestRules.Validate(
            provider: "minimax",
            count: 3,
            type: "single",
            difficultyTagId: 1,
            tagIds: [],
            prompt: new string('x', AiGenerationRequestRules.MaxPromptLength));

        errors.ShouldNotContainKey("Prompt");
    }

    [Fact]
    public void 标签超过上限时报出上限()
    {
        var tagIds = Enumerable.Range(1, Question.MaxTagCount + 1).Select(i => (long)i).ToArray();

        var errors = AiGenerationRequestRules.Validate(
            provider: "minimax",
            count: 3,
            type: "single",
            difficultyTagId: 1,
            tagIds: tagIds,
            prompt: "出题");

        errors.ShouldContainKey("TagIds");
        errors["TagIds"].ShouldContain($"知识点标签不能超过 {Question.MaxTagCount} 个。");
    }

    [Fact]
    public void 标签重复的不算超限()
    {
        var tagIds = Enumerable.Repeat(1L, Question.MaxTagCount + 1).ToArray();

        var errors = AiGenerationRequestRules.Validate(
            provider: "minimax",
            count: 3,
            type: "single",
            difficultyTagId: 1,
            tagIds: tagIds,
            prompt: "出题");

        errors.ShouldNotContainKey("TagIds");
    }

    [Fact]
    public void 题型不认识时报出提示()
    {
        var errors = AiGenerationRequestRules.Validate(
            provider: "minimax",
            count: 3,
            type: "填空题",
            difficultyTagId: 1,
            tagIds: [],
            prompt: "出题");

        errors.ShouldContainKey("Type");
        errors["Type"].ShouldContain("题型无法识别。");
    }

    [Fact]
    public void 难度没选时报出提示()
    {
        var errors = AiGenerationRequestRules.Validate(
            provider: "minimax",
            count: 3,
            type: "single",
            difficultyTagId: 0,
            tagIds: [],
            prompt: "出题");

        errors.ShouldContainKey("DifficultyTagId");
        errors["DifficultyTagId"].ShouldContain("请选择难度标签。");
    }

    [Fact]
    public void 供应商没选时报出提示()
    {
        var errors = AiGenerationRequestRules.Validate(
            provider: "",
            count: 3,
            type: "single",
            difficultyTagId: 1,
            tagIds: [],
            prompt: "出题");

        errors.ShouldContainKey("Provider");
        errors["Provider"].ShouldContain("请选择 AI 供应商。");
    }

    [Fact]
    public void 多个字段不合法时都报出来()
    {
        var errors = AiGenerationRequestRules.Validate(
            provider: "",
            count: 0,
            type: "填空题",
            difficultyTagId: 0,
            tagIds: [],
            prompt: "");

        errors.Keys.ShouldBe(
            new[] { "Provider", "Count", "Type", "DifficultyTagId", "Prompt" },
            ignoreOrder: true);
    }

    [Fact]
    public void 错误字段名与前端登记的一致()
    {
        // 前端 `AI_FIELD_LABELS` 按这些字段名翻成中文给老师看：
        // 名字对不上，界面上就会甩一个英文的字段名出来。
        var errors = AiGenerationRequestRules.Validate(
            provider: "",
            count: 0,
            type: "填空题",
            difficultyTagId: 0,
            tagIds: Enumerable.Range(1, Question.MaxTagCount + 1).Select(i => (long)i).ToArray(),
            prompt: "");

        errors.Keys.ShouldBe(
            new[] { "Provider", "Count", "Type", "DifficultyTagId", "TagIds", "Prompt" },
            ignoreOrder: true);
    }
}
