using System.Text.RegularExpressions;

namespace Exam.Application.Catalog.Services;

/// <summary>
/// 题干的质量检查。
/// <para>
/// 模型常常把「答案 B」「4 个选项」这类**出题痕迹**写进题干——
/// 这样的题进了题库就是一道泄题的题。这类痕迹一般出现在题干末尾的括号里
/// （「……（　　）（答案 B，4 个选项）」），把那个括号去掉题干就干净了；
/// 去掉之后还泄题，才算不合格，那道题不落库。
/// </para>
/// </summary>
public static class AiStemQuality
{
    /// <summary>答案痕迹：「答案」「正确答案」「Answer」后面跟着选项键。</summary>
    private static readonly Regex AnswerLeak = new(
        @"(正确答案|答案|answers?)\s*(是|为|is|are|[:：])?\s*[A-F](?![A-Za-z])",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>
    /// 出题痕迹：「4 个选项」这类描述自己怎么出的题。
    /// <para>
    /// 只用来判断末尾那个括号该不该去掉，**不据此判不合格**：
    /// 「下列 4 个选项中正确的是」是正经题干，不能因为有「4 个选项」就毙掉。
    /// </para>
    /// </summary>
    private static readonly Regex ConstructionTrace = new(
        @"\d+\s*(个选项|options?)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>题干末尾的一对括号（中文或英文）。</summary>
    private static readonly Regex TrailingBracket = new(
        @"[（(][^（()）]*[）)]\s*$",
        RegexOptions.Compiled);

    /// <summary>
    /// 清理题干并给出问题清单。
    /// <para>返回的题干是清理后的（去掉末尾的出题痕迹括号）。</para>
    /// </summary>
    public static (string Stem, IReadOnlyList<string> Problems) Check(string stem)
    {
        var text = (stem ?? string.Empty).Trim();
        var problems = new List<string>();

        // 末尾括号里带着出题痕迹的，整个去掉。
        var bracket = TrailingBracket.Match(text);
        if (bracket.Success
            && (AnswerLeak.IsMatch(bracket.Value) || ConstructionTrace.IsMatch(bracket.Value)))
        {
            text = text[..bracket.Index].TrimEnd();
        }

        if (AnswerLeak.IsMatch(text))
        {
            problems.Add("题干里泄露了答案（出现「答案 B」这类文字），请调整出题要求后重试。");
        }

        return (text, problems);
    }
}
