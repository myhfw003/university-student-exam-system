using Exam.Application.Catalog.Services;
using Exam.Domain.Catalog;
using Shouldly;

namespace Exam.Application.UnitTests.Catalog;

/// <summary>
/// 模型草稿 → 导入行的翻译。
/// <para>
/// 翻译完就走文件导入那条路，于是模型产的题与老师上传的题受同一套规则管。
/// 这一层要做的是把模型的各种写法**归一**成解析器认得的格式。
/// </para>
/// </summary>
public sealed class AiDraftRowMapperTests
{
    [Fact]
    public void 选项没带键时按顺序补键()
    {
        var draft = new AiQuestionDraft("题干", "single", ["甲", "乙"], ["A"], null, null, [], 5);

        var row = AiDraftRowMapper.ToRow(draft);

        row["options"].ShouldBe("A. 甲|B. 乙");
    }

    [Fact]
    public void 选项已经带键时保持原样()
    {
        var draft = new AiQuestionDraft("题干", "single", ["A. 甲", "B. 乙"], ["A"], null, null, [], 5);

        var row = AiDraftRowMapper.ToRow(draft);

        row["options"].ShouldBe("A. 甲|B. 乙");
    }

    [Fact]
    public void 判断题固定两个选项且答案只认A或B()
    {
        var draft = new AiQuestionDraft("题干", "judge", ["正确", "错误"], ["B"], null, null, [], null);

        var row = AiDraftRowMapper.ToRow(draft);

        row["options"].ShouldBe("A. 正确|B. 错误");
        row["answer"].ShouldBe("B");
    }

    [Fact]
    public void 综合题不带分值由步骤之和决定()
    {
        var steps = new[]
        {
            new AiQuestionDraftStep("s1", "第一步", 5, "要点一"),
            new AiQuestionDraftStep("s2", "第二步", 5, "要点二"),
        };

        var draft = new AiQuestionDraft("题干", "comprehensive", [], [], null, null, steps, 8);

        var row = AiDraftRowMapper.ToRow(draft);

        // 模型给的分值与步骤对不上时以步骤为准——综合题的分值必须等于步骤之和。
        row["score"].ShouldBeNull();
        row["steps"].ShouldBe("s1|第一步|5|要点一\ns2|第二步|5|要点二");
    }

    [Fact]
    public void 翻译出来的行能被导入解析器认下()
    {
        var draft = new AiQuestionDraft("题干", "single", ["A. 甲", "B. 乙"], ["A"], "解析", null, [], 5);

        var (parsed, errors) = QuestionImportParser.Parse(AiDraftRowMapper.ToRow(draft));

        errors.ShouldBeEmpty();
        parsed.ShouldNotBeNull();
        parsed!.Type.ShouldBe(QuestionType.Single);
        parsed.Options.Count.ShouldBe(2);
        parsed.Options[0].IsCorrect.ShouldBeTrue();
        parsed.Options[1].IsCorrect.ShouldBeFalse();
        parsed.Analysis.ShouldBe("解析");
    }

    [Fact]
    public void 判断题翻译后解析出B是正确项()
    {
        var draft = new AiQuestionDraft("题干", "judge", [], ["B"], null, null, [], null);

        var (parsed, errors) = QuestionImportParser.Parse(AiDraftRowMapper.ToRow(draft));

        errors.ShouldBeEmpty();
        parsed!.Options.Single(o => o.IsCorrect).Key.ShouldBe("B");
    }
}
