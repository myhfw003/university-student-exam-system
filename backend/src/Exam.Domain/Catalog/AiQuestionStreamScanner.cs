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
/// 只认第一层「数组里的对象」：模型爱把结果包成 <c>{"questions":[…]}</c>，
/// 那个外层对象不是题，不能当题收。
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

            if (ch == '[' && !_inItems)
            {
                // 第一个数组就是题目数组（外层 {"questions":[…]} 的括号在它前面）。
                // 深度从 0 重新数：外层包装对象的括号不参与配平，
                // 否则数组里那道题会被当成「包装对象的一部分」而永远凑不齐。
                _inItems = true;
                _depth = 0;
                _itemStart = -1;
                _cursor++;
                continue;
            }

            if (!_inItems)
            {
                // 数组之前的内容（多半是 {"questions": 这样的包装）不参与配平。
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
                _depth--;

                if (_inItems && _depth == 0 && _itemStart >= 0)
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
