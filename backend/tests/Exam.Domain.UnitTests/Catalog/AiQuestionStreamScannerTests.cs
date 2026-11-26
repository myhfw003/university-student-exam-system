using Exam.Domain.Catalog;
using Shouldly;

namespace Exam.Domain.UnitTests.Catalog;

/// <summary>
/// 流式文本扫描：把模型一段段吐出来的 JSON，切成一道道完整的题。
/// <para>
/// 这一层是「边生成边落库」的地基：题目凑齐了就能先入库、先给老师看，
/// 不用等整批收完。
/// </para>
/// </summary>
public sealed class AiQuestionStreamScannerTests
{
    [Fact]
    public void 分段喂入时凑齐一道就吐一道()
    {
        var scanner = new AiQuestionStreamScanner();
        var done = new List<string>();

        // 一道题分三次喂：第一次不完整，不该吐。
        done.AddRange(scanner.Feed("[{\"stem\":\"题干一\",\"type\":\"single\","));
        done.ShouldBeEmpty();

        // 第二段补齐了第一道题（末尾的 } 把它合上了）——这时就该吐出来。
        done.AddRange(scanner.Feed("\"options\":[\"A. 甲\"],\"answer\":[\"A\"]},"));
        done.Count.ShouldBe(1);
        done[0].ShouldContain("题干一");

        // 第三段是第二道题，凑齐后再吐。
        done.AddRange(scanner.Feed("{\"stem\":\"题干二\",\"type\":\"single\"}]"));
        done.Count.ShouldBe(2);
        done[1].ShouldContain("题干二");
    }

    [Fact]
    public void 外层的questions包装不算题()
    {
        var scanner = new AiQuestionStreamScanner();

        var done = scanner.Feed("{\"questions\":[{\"stem\":\"题干\",\"type\":\"single\"}]}");

        // 只吐数组里的那道题，外层包装对象不算。
        done.Count.ShouldBe(1);
        done[0].ShouldStartWith("{\"stem\"");
    }

    [Fact]
    public void 字符串里的花括号不计入配平()
    {
        var scanner = new AiQuestionStreamScanner();

        var done = scanner.Feed("[{\"stem\":\"答案是 {A}\",\"type\":\"single\"}]");

        done.Count.ShouldBe(1);
        done[0].ShouldContain("答案是 {A}");
    }

    [Fact]
    public void 一段里有多道题就都吐出来()
    {
        var scanner = new AiQuestionStreamScanner();

        var done = scanner.Feed(
            "[{\"stem\":\"一\",\"type\":\"single\"},{\"stem\":\"二\",\"type\":\"single\"},{\"stem\":\"三\",\"type\":\"single\"}]");

        done.Count.ShouldBe(3);
        done[2].ShouldContain("三");
    }

    [Fact]
    public void 转义引号不打断解析()
    {
        var scanner = new AiQuestionStreamScanner();

        var done = scanner.Feed("[{\"stem\":\"引号 \\\" 与括号 {x}\",\"type\":\"single\"}]");

        done.Count.ShouldBe(1);
        done[0].ShouldContain("引号");
    }

    [Fact]
    public void 收尾时把没凑完的最后一段交出来()
    {
        var scanner = new AiQuestionStreamScanner();

        scanner.Feed("[{\"stem\":\"半截\",\"type\":\"sing");
        var tail = scanner.Flush();

        tail.ShouldNotBeNull();
        tail.ShouldContain("半截");
    }

    [Fact]
    public void 凑齐的题在收尾时不再重复交出()
    {
        var scanner = new AiQuestionStreamScanner();

        scanner.Feed("[{\"stem\":\"完整\",\"type\":\"single\"}]");
        scanner.Flush().ShouldBeNull();
    }
}
