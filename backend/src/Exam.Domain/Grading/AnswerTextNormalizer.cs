using System.Globalization;
using System.Text;

namespace Exam.Domain.Grading;

/// <summary>
/// 作答文本归一化。
/// <para>
/// 关键词匹配前先归一化：全角转半角、去空白、去标点、大小写折叠。
/// 否则「TCP 三次握手」和「tcp三次握手」会判成没命中。
/// </para>
/// </summary>
public static class AnswerTextNormalizer
{
    /// <summary>归一化后忽略的标点（中英文都覆盖）。</summary>
    private static readonly char[] IgnoredPunctuation =
    [
        ',', '.', ';', ':', '!', '?', '(', ')', '[', ']', '{', '}',
        '"', '\'', '`', '~', '-', '_', '/', '\\', '|', '@', '#', '$',
        '%', '^', '&', '*', '+', '=', '<', '>', '、', '。', '，', '；',
        '：', '！', '？', '“', '”', '‘', '’', '（', '）', '【', '】',
        '《', '》', '—', '…', '·',
    ];

    /// <summary>归一化文本。</summary>
    public static string Normalize(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return string.Empty;
        }

        // FormKC 把全角字母数字与全角标点折叠成半角。
        var folded = text.Normalize(NormalizationForm.FormKC);

        var builder = new StringBuilder(folded.Length);
        foreach (var ch in folded)
        {
            if (char.IsWhiteSpace(ch))
            {
                continue;
            }

            if (Array.IndexOf(IgnoredPunctuation, ch) >= 0)
            {
                continue;
            }

            builder.Append(char.ToLowerInvariant(ch));
        }

        return builder.ToString();
    }

    /// <summary>归一化后判断是否包含（包含匹配）。</summary>
    public static bool Contains(string? haystack, string? needle)
    {
        var normalizedNeedle = Normalize(needle);
        if (normalizedNeedle.Length == 0)
        {
            return false;
        }

        return Normalize(haystack).Contains(normalizedNeedle, StringComparison.Ordinal);
    }

    /// <summary>归一化后判断是否包含全部关键词（AND 语义）。</summary>
    public static bool ContainsAll(string? haystack, IEnumerable<string>? keywords)
    {
        if (keywords is null)
        {
            return false;
        }

        var list = keywords.Where(k => !string.IsNullOrWhiteSpace(k)).ToList();
        if (list.Count == 0)
        {
            return false;
        }

        return list.All(k => Contains(haystack, k));
    }
}
