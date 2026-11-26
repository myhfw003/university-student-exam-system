using Exam.Domain.Catalog;
using Shouldly;

namespace Exam.Domain.UnitTests.Catalog;

/// <summary>
/// 大模型输出的解析。
/// <para>
/// 模型的输出形状很不稳定：思考段、代码块、顶层是数组还是对象、
/// 选项写成数组还是写成 <c>{"A":"…"}</c> 对象映射——实测 MiniMax 就返回后者。
/// 这一层只做**提取**，提取不出来要说人话，不抛异常。
/// </para>
/// </summary>
public sealed class AiQuestionDraftParserTests
{
    [Fact]
    public void 剥掉思考段与代码块后取出题目()
    {
        var raw = """
            <think>先想想题型</think>

            ```json
            [{"stem":"题干","type":"single","options":["A. 甲","B. 乙"],"answer":["A"]}]
            ```
            """;

        var results = AiQuestionDraftParser.Parse(raw);

        results.Count.ShouldBe(1);
        results[0].Succeeded.ShouldBeTrue();
        results[0].Draft!.Stem.ShouldBe("题干");
        results[0].Draft!.Type.ShouldBe("single");
        results[0].Draft!.Options.ShouldBe(["A. 甲", "B. 乙"]);
        results[0].Draft!.Answer.ShouldBe(["A"]);
    }

    [Fact]
    public void 选项写成对象映射时照样读得出来()
    {
        // 实测 MiniMax 就是这么返回的：选项是 {"A":"…"} 而不是数组。
        var raw = """
            [{"stem":"题干","type":"single","options":{"A":"甲","B":"乙"},"answer":"B"}]
            """;

        var results = AiQuestionDraftParser.Parse(raw);

        results.Count.ShouldBe(1);
        results[0].Succeeded.ShouldBeTrue();
        results[0].Draft!.Options.ShouldBe(["A. 甲", "B. 乙"]);
        results[0].Draft!.Answer.ShouldBe(["B"]);
    }

    [Fact]
    public void 顶层是questions对象时也能取出数组()
    {
        var raw = """
            {"questions":[{"stem":"题干","type":"single","options":["A. 甲"],"answer":["A"]}]}
            """;

        var results = AiQuestionDraftParser.Parse(raw);

        results.Count.ShouldBe(1);
        results[0].Succeeded.ShouldBeTrue();
        results[0].Draft!.Stem.ShouldBe("题干");
    }

    [Fact]
    public void 顶层就是一道题时也能取出来()
    {
        var raw = """{"stem":"题干","type":"single","options":["A. 甲"],"answer":["A"]}""";

        var results = AiQuestionDraftParser.Parse(raw);

        results.Count.ShouldBe(1);
        results[0].Succeeded.ShouldBeTrue();
    }

    [Fact]
    public void 判断题答案的正确与错误归一化成A与B()
    {
        var raw = """
            [{"stem":"题干","type":"judge","options":{"A":"正确","B":"错误"},"answer":"错误"}]
            """;

        var results = AiQuestionDraftParser.Parse(raw);

        results[0].Draft!.Answer.ShouldBe(["B"]);
    }

    [Fact]
    public void 多个答案用空格分隔时拆成多个()
    {
        var raw = """[{"stem":"题干","type":"multi","options":["A. 甲","B. 乙"],"answer":"A B"}]""";

        var results = AiQuestionDraftParser.Parse(raw);

        results[0].Draft!.Answer.ShouldBe(["A", "B"]);
    }

    [Fact]
    public void 简答题参考答案里的空格不被拆开()
    {
        // 参考答案是一段话，不是选项键列表——拆开就毁了。
        var raw = """[{"stem":"简述过程","type":"short","answer":"客户端 SYN 服务端 SYN+ACK 客户端 ACK"}]""";

        var results = AiQuestionDraftParser.Parse(raw);

        results[0].Draft!.Answer.ShouldBe(["客户端 SYN 服务端 SYN+ACK 客户端 ACK"]);
    }

    [Fact]
    public void 综合题步骤读出编码提示分值与参考答案()
    {
        var raw = """
            [{"stem":"题干","type":"comprehensive","steps":[{"code":"s1","prompt":"第一步","score":5,"referenceAnswer":"要点一"}]}]
            """;

        var results = AiQuestionDraftParser.Parse(raw);

        var steps = results[0].Draft!.Steps;
        steps.Count.ShouldBe(1);
        steps[0].Code.ShouldBe("s1");
        steps[0].Prompt.ShouldBe("第一步");
        steps[0].Score.ShouldBe(5);
        steps[0].ReferenceAnswer.ShouldBe("要点一");
    }

    [Fact]
    public void 坏JSON给出错误而不是抛异常()
    {
        var results = AiQuestionDraftParser.Parse("{ 这不是 JSON");

        results.Count.ShouldBe(1);
        results[0].Succeeded.ShouldBeFalse();
        results[0].Error.ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public void 完全没有JSON时给出错误()
    {
        var results = AiQuestionDraftParser.Parse("模型今天不想出题");

        results.Count.ShouldBe(1);
        results[0].Succeeded.ShouldBeFalse();
    }

    [Fact]
    public void 缺题干的题单独报错不影响其它题()
    {
        var raw = """
            [{"type":"single","options":["A. 甲"],"answer":["A"]},{"stem":"好的题干","type":"single","options":["A. 甲"],"answer":["A"]}]
            """;

        var results = AiQuestionDraftParser.Parse(raw);

        results.Count.ShouldBe(2);
        results[0].Succeeded.ShouldBeFalse();
        results[1].Succeeded.ShouldBeTrue();
    }
}
