namespace Exam.Domain.Catalog;

/// <summary>
/// 找模型输出里的 JSON 载荷。
/// <para>
/// **流式与非流式共用这一份**：模型吐出什么形状并不固定，
/// 有的直接给数组、有的包成 <c>{"questions":[…]}</c>、
/// 有的先来一段说明或思考段。两边各写一套找法，必然一边认得一边不认得
/// （2026-11-26 实测：思考段里带一个方括号，流式那条路就把整个包装对象
/// 当成了一道题，题一道都没出来）。
/// </para>
/// </summary>
public static class AiJsonPayload
{
    /// <summary>
    /// 题目数组的起点：第一个「后面紧跟对象」的左方括号。
    /// <para>
    /// 认的是 <c>[{</c> 而不是裸的 <c>[</c>：说明里的 <c>[TCP]</c>、
    /// 思考段里的 <c>[1]</c> 都不是题目数组。
    /// </para>
    /// </summary>
    /// <returns>起点下标；没找到返回 -1。</returns>
    public static int FindItemsArrayStart(string text)
    {
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] != '[')
            {
                continue;
            }

            var next = NextNonWhitespace(text, i + 1);
            if (next < 0)
            {
                // 后面还没有内容：可能正等着下一段，流式那条路靠这个返回 -1 等下一段。
                return -1;
            }

            if (text[next] == '{')
            {
                return i;
            }
        }

        return -1;
    }

    /// <summary>下一个非空白字符的下标；后面没有了返回 -1。</summary>
    public static int NextNonWhitespace(string text, int from)
    {
        for (var i = from; i < text.Length; i++)
        {
            if (!char.IsWhiteSpace(text[i]))
            {
                return i;
            }
        }

        return -1;
    }

    /// <summary>从起点截取一段括号配平的 JSON 文本；没配平返回 null。</summary>
    public static string? SliceBalanced(string text, int start, char open, char close)
    {
        var depth = 0;
        var inString = false;
        var escaped = false;

        for (var i = start; i < text.Length; i++)
        {
            var ch = text[i];

            if (inString)
            {
                if (escaped)
                {
                    escaped = false;
                }
                else if (ch == '\\')
                {
                    escaped = true;
                }
                else if (ch == '"')
                {
                    inString = false;
                }

                continue;
            }

            if (ch == '"')
            {
                inString = true;
                continue;
            }

            if (ch == open)
            {
                depth++;
                continue;
            }

            if (ch == close)
            {
                depth--;
                if (depth == 0)
                {
                    return text[start..(i + 1)];
                }
            }
        }

        return null;
    }
}
