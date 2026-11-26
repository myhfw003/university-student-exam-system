using System.Text;

namespace Exam.Domain.Catalog;

/// <summary>
/// 流式文本 → 一道道完整的题。
/// <para>
/// 模型是**流式**吐 JSON 的：一整个题目数组分很多段发过来。
/// 这里把文本攒起来，边攒边找**花括号配平**的题目对象——凑齐一道就吐一道，
/// 不用等整段收完。这样老师能看着题目一道道落进候选题队列，
/// 而不是盯着一个转圈等一分多钟。
/// </para>
/// <para>
/// **题目数组的认法与非流式那条路一致**（见 <see cref="AiJsonPayload"/>）：
/// 认的是「后面紧跟对象」的左方括号 <c>[{</c>，不是裸的 <c>[</c>。
/// 之前认裸方括号，模型思考段里带一个 <c>[TCP]</c> 就把整个
/// <c>{"questions":[…]}</c> 包装对象当成了一道题——题一道都没出来，
/// 只报一句「第 1 题缺少题干」。
/// </para>
/// </summary>
public sealed class AiQuestionStreamScanner
{
    private readonly StringBuilder _buffer = new();

    /// <summary>已扫描到的位置。</summary>
    private int _cursor;

    /// <summary>是否已经进入题目数组。</summary>
    private bool _inItems;

    /// <summary>当前对象的花括号深度。</summary>
    private int _depth;

    /// <summary>当前题目的起始位置（-1 表示当前不在题里）。</summary>
    private int _itemStart = -1;

    /// <summary>是否在字符串里（字符串里的花括号不算）。</summary>
    private bool _inString;

    /// <summary>上一个字符是不是转义符。</summary>
    private bool _escaped;

    /// <summary>
    /// 喂一段文本，吐出这段时间里已经**完整**的题目 JSON。
    /// <para>顺序与模型吐出的一致；没凑齐的留在缓冲里等下一段。</para>
    /// </summary>
    public IReadOnlyList<string> Feed(string chunk)
    {
        var completed = new List<string>();
        if (string.IsNullOrEmpty(chunk))
        {
            return completed;
        }

        _buffer.Append(chunk);
        var text = _buffer.ToString();

        while (_cursor < text.Length)
        {
            var ch = text[_cursor];

            if (_inString)
            {
                if (_escaped)
                {
                    _escaped = false;
                }
                else if (ch == '\\')
                {
                    _escaped = true;
                }
                else if (ch == '"')
                {
                    _inString = false;
                }

                _cursor++;
                continue;
            }

            if (ch == '"')
            {
                _inString = true;
                _cursor++;
                continue;
            }

            if (!_inItems)
            {
                if (ch != '[')
                {
                    _cursor++;
                    continue;
                }

                // 找题目数组：左方括号后面（跳过空白）得紧跟一个对象。
                var next = AiJsonPayload.NextNonWhitespace(text, _cursor + 1);
                if (next < 0)
                {
                    // 后面还没内容，看不出是不是对象：等下一段再判断。
                    // 停在这里不动（不推进游标），下一段接着看。
                    break;
                }

                if (text[next] == '{')
                {
                    _inItems = true;
                    _depth = 0;
                    _itemStart = -1;
                }

                _cursor++;
                continue;
            }

            if (ch == '{')
            {
                if (_depth == 0)
                {
                    _itemStart = _cursor;
                }

                _depth++;
                _cursor++;
                continue;
            }

            if (ch == '}')
            {
                // 深度不为负：包装对象在数组之后的那个收尾括号不算题目的一部分。
                if (_depth > 0)
                {
                    _depth--;
                }

                if (_depth == 0 && _itemStart >= 0)
                {
                    completed.Add(text[_itemStart..(_cursor + 1)]);
                    _itemStart = -1;
                }

                _cursor++;
                continue;
            }

            _cursor++;
        }

        return completed;
    }

    /// <summary>
    /// 收尾：把缓冲里剩下的内容当最后一题试试。
    /// <para>模型被截断时，最后一道可能没凑完——能解析就算，解析不了就丢掉。</para>
    /// </summary>
    public string? Flush()
    {
        if (_itemStart < 0)
        {
            return null;
        }

        var text = _buffer.ToString();
        var tail = text[_itemStart..].TrimEnd();
        _itemStart = -1;

        return tail.Length > 0 ? tail : null;
    }
}
