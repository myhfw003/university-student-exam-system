using Exam.Domain.Catalog;
using Shouldly;

namespace Exam.Domain.UnitTests.Catalog;

/// <summary>
/// 流式扫描器对**模型前导内容**的容忍度。
/// <para>
/// 2026-11-26 公测机上实测：模型有时会在 JSON 前面带一段说明或思考段，
/// 里面带一个方括号。那次扫描器把整个 <c>{"questions":[…]}</c> 包装对象
/// 当成了一道题——题一道都没出来，只报「第 1 题缺少题干」。
/// </para>
/// <para>
/// 认法：**「后面紧跟对象」的左方括号**才是题目数组（<c>[{</c>），
/// 裸的 <c>[</c> 不算。与非流式那条路同一份规则。
/// </para>
/// </summary>
public sealed class AiQuestionStreamScannerPreambleTests
{
    private const string QuestionOne = """{"stem":"甲","type":"single","options":["A. 甲","B. 乙"],"answer":["A"]}""";
    private const string QuestionTwo = """{"stem":"乙","type":"single","options":["A. 甲","B. 乙"],"answer":["B"]}""";

    /// <summary>题目数组（包装形式）。</summary>
    private static string Wrapper => $$"""{"questions":[{{QuestionOne}},{{QuestionTwo}}]}""";

    /// <summary>题目数组（裸数组形式）。</summary>
    private static string BareArray => $$"""[{{QuestionOne}},{{QuestionTwo}}]""";

    /// <summary>按指定长度切段喂进去（模拟网络包），返回切出的每一项。</summary>
    private static IReadOnlyList<string> Scan(string text, int chunkSize)
    {
        var scanner = new AiQuestionStreamScanner();
        var items = new List<string>();

        for (var i = 0; i < text.Length; i += chunkSize)
        {
            items.AddRange(scanner.Feed(text.Substring(i, Math.Min(chunkSize, text.Length - i))));
        }

        var tail = scanner.Flush();
        if (tail is not null)
        {
            items.Add(tail);
        }

        return items;
    }

    [Theory]
    [InlineData("包装对象", null)]
    [InlineData("裸数组", null)]
    [InlineData("思考段里有方括号", "<think>让我想想 [TCP] 的细节</think>")]
    [InlineData("思考段没闭合", "<think>还在想 [1] ")]
    [InlineData("前导说明里有方括号", "以下是 3 道题：[题目]\n")]
    [InlineData("前导说明里有花括号", "说明 {\"note\":1}\n")]
    [InlineData("Markdown 代码块", "```json\n")]
    [InlineData("代码块加说明", "好的：\n```json\n")]
    public void 前导内容不影响切题(string name, string? preamble)
    {
        foreach (var payload in new[] { Wrapper, BareArray })
        {
            foreach (var chunkSize in new[] { 1, 3, 7, 24, 4096 })
            {
                var text = (preamble ?? string.Empty) + payload;
                var items = Scan(text, chunkSize);

                items.Count.ShouldBe(
                    2,
                    $"[{name}] 分段 {chunkSize}：应切出两道题，实际 {items.Count} 项：" +
                    string.Join(" | ", items));
            }
        }
    }

    [Fact]
    public void 包装对象不会本身被当成一道题()
    {
        var items = Scan("<think>想到 [X]</think>" + Wrapper, 9);

        items.Count.ShouldBe(2);
        items[0].ShouldStartWith("{\"stem\"");
        items[1].ShouldStartWith("{\"stem\"");
    }

    [Fact]
    public void 非流式那条路对同样的前导内容也要认得出()
    {
        var results = AiQuestionDraftParser.Parse("<think>让我想想 [TCP]</think>" + Wrapper);

        results.Count.ShouldBe(2);
        results.ShouldAllBe(r => r.Succeeded);
        results[0].Draft!.Stem.ShouldBe("甲");
        results[1].Draft!.Stem.ShouldBe("乙");
    }

    [Fact]
    public void 非流式那条路对说明里的方括号也要认得出()
    {
        var results = AiQuestionDraftParser.Parse("以下是 3 道题：[题目]\n" + Wrapper);

        results.Count.ShouldBe(2);
        results.ShouldAllBe(r => r.Succeeded);
    }
}
