using Exam.Domain.Catalog;
using Shouldly;

namespace Exam.Domain.UnitTests.Catalog;

public sealed class QuestionImportParserTests
{
    private static Dictionary<string, string?> Row(params (string Field, string? Value)[] values)
    {
        var row = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var (field, value) in values)
        {
            row[field] = value;
        }

        return row;
    }

    [Fact]
    public void 题型列接受中英文()
    {
        QuestionTypes.FromName("单选题").ShouldBe(QuestionType.Single);
        QuestionTypes.FromName("多选").ShouldBe(QuestionType.Multi);
        QuestionTypes.FromName("判断题").ShouldBe(QuestionType.Judge);
        QuestionTypes.FromName("简答题").ShouldBe(QuestionType.Short);
        QuestionTypes.FromName("综合题").ShouldBe(QuestionType.Comprehensive);
        QuestionTypes.FromName("single").ShouldBe(QuestionType.Single);
        QuestionTypes.FromName("不存在的题型").ShouldBeNull();
    }

    [Fact]
    public void 选项支持竖线分隔与多行两种写法()
    {
        var piped = QuestionImportParser.ParseOptions("A. 甲|B. 乙|C. 丙");
        piped.Count.ShouldBe(3);
        piped[0].Key.ShouldBe("A");
        piped[0].Text.ShouldBe("甲");

        var multiLine = QuestionImportParser.ParseOptions("A. 甲\nB. 乙");
        multiLine.Count.ShouldBe(2);
        multiLine[1].Key.ShouldBe("B");
        multiLine[1].Text.ShouldBe("乙");
    }

    [Fact]
    public void 选项分隔符支持中文句点()
    {
        var options = QuestionImportParser.ParseOptions("A、甲|B、乙");
        options[0].Key.ShouldBe("A");
        options[0].Text.ShouldBe("甲");
    }

    [Fact]
    public void 合法单选行解析成功且正确项被标记()
    {
        var (question, errors) = QuestionImportParser.Parse(Row(
            ("type", "单选题"),
            ("stem", "题干"),
            ("options", "A. 甲|B. 乙"),
            ("answer", "A"),
            ("score", "5")));

        errors.ShouldBeEmpty();
        question.ShouldNotBeNull();
        question!.Type.ShouldBe(QuestionType.Single);
        question.Score.ShouldBe(5m);
        question.Options.Count.ShouldBe(2);
        question.Options.Single(o => o.IsCorrect).Key.ShouldBe("A");
    }

    [Fact]
    public void 答案不在选项范围内时报错()
    {
        var (question, errors) = QuestionImportParser.Parse(Row(
            ("type", "单选题"),
            ("stem", "题干"),
            ("options", "A. 甲|B. 乙"),
            ("answer", "C")));

        question.ShouldBeNull();
        errors.ShouldHaveSingleItem();
        errors[0].Field.ShouldBe("answer");
        errors[0].Reason.ShouldContain("不在选项范围内");
    }

    [Fact]
    public void 题干为空时报错()
    {
        var (question, errors) = QuestionImportParser.Parse(Row(
            ("type", "单选题"),
            ("stem", "  "),
            ("options", "A. 甲|B. 乙"),
            ("answer", "A")));

        question.ShouldBeNull();
        errors.ShouldHaveSingleItem();
        errors[0].Field.ShouldBe("stem");
    }

    [Fact]
    public void 难度接受中文名与数字()
    {
        var (byName, nameErrors) = QuestionImportParser.Parse(Row(
            ("type", "单选题"),
            ("stem", "题干"),
            ("options", "A. 甲|B. 乙"),
            ("answer", "A"),
            ("difficulty", "基础")));

        nameErrors.ShouldBeEmpty();
        byName!.DifficultyName.ShouldBe("基础");

        var (byNumber, numberErrors) = QuestionImportParser.Parse(Row(
            ("type", "单选题"),
            ("stem", "题干"),
            ("options", "A. 甲|B. 乙"),
            ("answer", "A"),
            ("difficulty", "2")));

        numberErrors.ShouldBeEmpty();
        byNumber!.DifficultyName.ShouldBe("2");
    }

    [Fact]
    public void 无法识别的难度报错()
    {
        var (question, errors) = QuestionImportParser.Parse(Row(
            ("type", "单选题"),
            ("stem", "题干"),
            ("options", "A. 甲|B. 乙"),
            ("answer", "A"),
            ("difficulty", "特别难")));

        question.ShouldBeNull();
        errors.ShouldHaveSingleItem();
        errors[0].Field.ShouldBe("difficulty");
    }

    [Fact]
    public void 分值不合法时报错()
    {
        var (question, errors) = QuestionImportParser.Parse(Row(
            ("type", "单选题"),
            ("stem", "题干"),
            ("options", "A. 甲|B. 乙"),
            ("answer", "A"),
            ("score", "0")));

        question.ShouldBeNull();
        errors.ShouldHaveSingleItem();
        errors[0].Field.ShouldBe("score");
    }

    [Fact]
    public void 综合题解析步骤()
    {
        var (question, errors) = QuestionImportParser.Parse(Row(
            ("type", "综合题"),
            ("stem", "题干"),
            ("steps", "s1|第一步|4\ns2|第二步|6"),
            ("score", "10")));

        errors.ShouldBeEmpty();
        question!.Steps.Count.ShouldBe(2);
        question.Steps[1].Code.ShouldBe("s2");
        question.Steps[1].Score.ShouldBe(6m);
    }

    [Fact]
    public void 综合题缺少步骤时报错()
    {
        var (question, errors) = QuestionImportParser.Parse(Row(
            ("type", "综合题"),
            ("stem", "题干"),
            ("score", "10")));

        question.ShouldBeNull();
        errors.ShouldContain(e => e.Field == "steps");
    }

    [Fact]
    public void 知识点按逗号与顿号切分()
    {
        var (question, errors) = QuestionImportParser.Parse(Row(
            ("type", "单选题"),
            ("stem", "题干"),
            ("options", "A. 甲|B. 乙"),
            ("answer", "A"),
            ("tags", "极限、连续，导数")));

        errors.ShouldBeEmpty();
        question!.TagNames.ShouldBe(["极限", "连续", "导数"]);
    }
}
