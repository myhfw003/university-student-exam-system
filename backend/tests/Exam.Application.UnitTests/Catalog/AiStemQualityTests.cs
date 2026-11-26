using Exam.Application.Catalog.Services;
using Shouldly;

namespace Exam.Application.UnitTests.Catalog;

/// <summary>
/// 题干的质量检查。
/// <para>
/// 模型爱把「答案 B」「4 个选项」写进题干——实测 MiniMax 就这么返回过。
/// 末尾括号里的痕迹去掉即可；去掉后还泄题，那道题不该入库。
/// </para>
/// </summary>
public sealed class AiStemQualityTests
{
    [Fact]
    public void 末尾括号里的出题痕迹被去掉()
    {
        var (stem, problems) = AiStemQuality.Check("TCP 三次握手的主要作用是（　　）（答案 B，4 个选项）");

        stem.ShouldBe("TCP 三次握手的主要作用是（　　）");
        problems.ShouldBeEmpty();
    }

    [Fact]
    public void 英文括号里的痕迹也去掉()
    {
        var (stem, problems) = AiStemQuality.Check("Which one is right (Answer: B, 4 options)");

        stem.ShouldBe("Which one is right");
        problems.ShouldBeEmpty();
    }

    [Fact]
    public void 去掉括号后仍泄题就判不合格()
    {
        var (_, problems) = AiStemQuality.Check("下列说法中，答案 B 正确的是（　　）");

        problems.Count.ShouldBe(1);
        problems[0].ShouldContain("泄露了答案");
    }

    [Fact]
    public void 正常题干不受影响()
    {
        var (stem, problems) = AiStemQuality.Check("下列关于 TCP 三次握手的说法，正确的是？");

        stem.ShouldBe("下列关于 TCP 三次握手的说法，正确的是？");
        problems.ShouldBeEmpty();
    }

    [Fact]
    public void 题干里的答案管理不算泄题()
    {
        // 「答案」后面跟的是汉字而不是选项键，不该被当成泄题。
        var (stem, problems) = AiStemQuality.Check("简述答案管理系统的工作流程");

        stem.ShouldBe("简述答案管理系统的工作流程");
        problems.ShouldBeEmpty();
    }

    [Fact]
    public void 正经题干里的四个选项不算出题痕迹()
    {
        // 「下列 4 个选项中正确的是」是正常的问法，不能毙掉。
        var (stem, problems) = AiStemQuality.Check("下列 4 个选项中正确的是？");

        stem.ShouldBe("下列 4 个选项中正确的是？");
        problems.ShouldBeEmpty();
    }

    [Fact]
    public void 出题痕迹被清掉后题干仍然可用()
    {
        var (stem, problems) = AiStemQuality.Check("TCP 连接关闭需要四次挥手（4 个选项）");

        stem.ShouldBe("TCP 连接关闭需要四次挥手");
        problems.ShouldBeEmpty();
    }
}
