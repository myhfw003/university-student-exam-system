using System.Text.Json;

namespace Exam.Domain.Catalog;

/// <summary>
/// 大模型生成的**一道题草稿**（尚未落库）。
/// <para>
/// 字段与导入行一一对应：模型给什么，这里就存什么，
/// 合法性判断交给 <see cref="QuestionImportParser"/>——与文件导入共用同一套规则。
/// </para>
/// </summary>
public sealed record AiQuestionDraft(
    string Stem,
    string Type,
    IReadOnlyList<string> Options,
    IReadOnlyList<string> Answer,
    string? Analysis,
    string? ReferenceAnswer,
    IReadOnlyList<AiQuestionDraftStep> Steps,
    decimal? Score);

/// <summary>草稿里的一个评分步骤（综合题用）。</summary>
public sealed record AiQuestionDraftStep(string Code, string Prompt, decimal? Score, string? ReferenceAnswer);

/// <summary>
/// 大模型输出的解析器。
/// <para>
/// 模型返回的是**文本**：可能带思考段（<think>…</think>）、可能裹着 Markdown 代码块、
/// 顶层可能是数组也可能是 {"questions":[…]}。这里只做**提取**，
/// 不做业务判断——业务判断在 <see cref="QuestionImportParser"/>。
/// </para>
/// </summary>
public static class AiQuestionDraftParser
{
    /// <summary>支持的题型词表（与 <see cref="QuestionTypes.FromName"/> 对齐）。</summary>
    private static readonly string[] TypeWords =
    [
        "single", "multi", "judge", "short", "comprehensive",
        "单选题", "多选题", "判断题", "简答题", "综合题",
    ];

    /// <summary>
    /// 从模型原始输出里取出题目草稿。
    /// <para>
    /// 返回的每一项都带 <paramref name="error"/>：模型少给字段、题型不认识、
    /// JSON 坏掉，都在这一层说明白，而不是让整批失败。
    /// </para>
    /// </summary>
    public static IReadOnlyList<AiQuestionDraftResult> Parse(string? raw)
    {
        var results = new List<AiQuestionDraftResult>();

        var text = ExtractJson(raw);
        if (text is null)
        {
            results.Add(AiQuestionDraftResult.Failed("模型没有返回可解析的 JSON。"));
            return results;
        }

        JsonElement root;
        try
        {
            using var document = JsonDocument.Parse(text);
            root = document.RootElement.Clone();
        }
        catch (JsonException ex)
        {
            results.Add(AiQuestionDraftResult.Failed($"模型返回的 JSON 无法解析：{ex.Message}"));
            return results;
        }

        var items = FindQuestionItems(root);
        if (items is null)
        {
            results.Add(AiQuestionDraftResult.Failed("模型返回的 JSON 里没有题目数组。"));
            return results;
        }

        var index = 0;
        foreach (var item in items)
        {
            index++;
            results.Add(ParseOne(item, index));
        }

        if (results.Count == 0)
        {
            results.Add(AiQuestionDraftResult.Failed("模型没有生成任何题目。"));
        }

        return results;
    }

    /// <summary>
    /// 解析**一道**题的 JSON 对象。
    /// <para>流式生成时用：每凑齐一道就单独喂进来。</para>
    /// </summary>
    public static AiQuestionDraftResult ParseQuestion(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return AiQuestionDraftResult.Failed("题目内容为空。");
        }

        JsonElement item;
        try
        {
            using var document = JsonDocument.Parse(json);
            item = document.RootElement.Clone();
        }
        catch (JsonException ex)
        {
            return AiQuestionDraftResult.Failed($"题目 JSON 无法解析：{ex.Message}");
        }

        return ParseOne(item, 1);
    }

    private static AiQuestionDraftResult ParseOne(JsonElement item, int index)
    {
        if (item.ValueKind != JsonValueKind.Object)
        {
            return AiQuestionDraftResult.Failed($"第 {index} 题不是对象。");
        }

        var stem = ReadString(item, "stem") ?? ReadString(item, "question") ?? ReadString(item, "题干");
        if (string.IsNullOrWhiteSpace(stem))
        {
            return AiQuestionDraftResult.Failed($"第 {index} 题缺少题干。");
        }

        var type = ReadString(item, "type") ?? ReadString(item, "题型") ?? "single";
        if (!TypeWords.Contains(type.Trim(), StringComparer.OrdinalIgnoreCase))
        {
            return AiQuestionDraftResult.Failed($"第 {index} 题的题型「{type}」无法识别。");
        }

        var options = ReadStringList(item, "options", "选项");
        var answer = ReadAnswer(item);
        var analysis = ReadString(item, "analysis") ?? ReadString(item, "解析");
        var referenceAnswer = ReadString(item, "referenceAnswer") ?? ReadString(item, "reference_answer");
        var score = ReadDecimal(item, "score", "分值");
        var steps = ReadSteps(item);

        return AiQuestionDraftResult.Ok(new AiQuestionDraft(
            stem.Trim(),
            type.Trim(),
            options,
            answer,
            string.IsNullOrWhiteSpace(analysis) ? null : analysis.Trim(),
            string.IsNullOrWhiteSpace(referenceAnswer) ? null : referenceAnswer.Trim(),
            steps,
            score));
    }

    /// <summary>剥掉思考段与代码块，取出 JSON 文本。</summary>
    private static string? ExtractJson(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var text = raw;

        // 思考段：<think>…</think>（含未闭合的情况）。
        var thinkStart = text.IndexOf("<think>", StringComparison.OrdinalIgnoreCase);
        if (thinkStart >= 0)
        {
            var thinkEnd = text.IndexOf("</think>", thinkStart, StringComparison.OrdinalIgnoreCase);
            text = thinkEnd >= 0
                ? text.Remove(thinkStart, thinkEnd + "</think>".Length - thinkStart)
                : text[..thinkStart];
        }

        // Markdown 代码块：```json … ``` 或 ``` … ```。
        var fence = text.IndexOf("```", StringComparison.Ordinal);
        if (fence >= 0)
        {
            var bodyStart = text.IndexOf('\n', fence);
            var closing = text.IndexOf("```", bodyStart < 0 ? fence + 3 : bodyStart, StringComparison.Ordinal);
            if (bodyStart > 0 && closing > bodyStart)
            {
                text = text[(bodyStart + 1)..closing];
            }
        }

        // 题目数组：认「后面紧跟对象」的左方括号（[{"…），不是裸的 [。
        // 说明段里的 [TCP]、思考段里的 [1] 都不算——认错了会整段解析失败。
        // 规则与流式那条路一致（AiJsonPayload），两边不能各认各的。
        var itemsStart = AiJsonPayload.FindItemsArrayStart(text);
        if (itemsStart >= 0)
        {
            return AiJsonPayload.SliceBalanced(text, itemsStart, '[', ']');
        }

        // 没有题目数组：退回第一个对象（模型只给了一道题的情况）。
        var objectStart = text.IndexOf('{', StringComparison.Ordinal);
        if (objectStart < 0)
        {
            return null;
        }

        return AiJsonPayload.SliceBalanced(text, objectStart, '{', '}');
    }

    /// <summary>在解析结果里找到题目数组。</summary>
    private static IReadOnlyList<JsonElement>? FindQuestionItems(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Array)
        {
            return root.EnumerateArray().ToList();
        }

        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var name in new[] { "questions", "items", "data", "题目", "questions_list" })
        {
            if (root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array)
            {
                return value.EnumerateArray().ToList();
            }
        }

        // 顶层就是一道题的情况。
        if (root.TryGetProperty("stem", out _) || root.TryGetProperty("题干", out _))
        {
            return [root];
        }

        return null;
    }

    private static string? ReadString(JsonElement item, params string[] names)
    {
        foreach (var name in names)
        {
            if (!item.TryGetProperty(name, out var value))
            {
                continue;
            }

            return value.ValueKind switch
            {
                JsonValueKind.String => value.GetString(),
                JsonValueKind.Number => value.ToString(),
                _ => null,
            };
        }

        return null;
    }

    private static decimal? ReadDecimal(JsonElement item, params string[] names)
    {
        var text = ReadString(item, names);
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        return decimal.TryParse(text, System.Globalization.NumberStyles.Any,
            System.Globalization.CultureInfo.InvariantCulture, out var value)
            ? value
            : null;
    }

    /// <summary>
    /// 读选项：字符串数组、{"key","text"} 对象数组、{"A":"甲"} 对象映射都认。
    /// <para>
    /// 对象映射是模型最常见的写法（实测 MiniMax 就这么返回），
    /// 统一还原成「A. 甲」——与导入解析器认的选项格式一致。
    /// </para>
    /// </summary>
    private static IReadOnlyList<string> ReadStringList(JsonElement item, params string[] names)
    {
        foreach (var name in names)
        {
            if (!item.TryGetProperty(name, out var value))
            {
                continue;
            }

            if (value.ValueKind == JsonValueKind.Array)
            {
                var list = new List<string>();
                foreach (var element in value.EnumerateArray())
                {
                    switch (element.ValueKind)
                    {
                        case JsonValueKind.String:
                            var text = element.GetString();
                            if (!string.IsNullOrWhiteSpace(text))
                            {
                                list.Add(text.Trim());
                            }

                            break;
                        case JsonValueKind.Object:
                            var key = ReadString(element, "key", "选项") ?? string.Empty;
                            var body = ReadString(element, "text", "内容", "选项") ?? string.Empty;
                            list.Add($"{key}. {body}".Trim());
                            break;
                    }
                }

                return list;
            }

            if (value.ValueKind == JsonValueKind.Object)
            {
                // 对象映射：{"A":"甲","B":"乙"} → "A. 甲"、"B. 乙"。
                var mapped = new List<string>();
                foreach (var property in value.EnumerateObject())
                {
                    var body = property.Value.ValueKind switch
                    {
                        JsonValueKind.String => property.Value.GetString(),
                        JsonValueKind.Number => property.Value.ToString(),
                        _ => null,
                    };

                    if (string.IsNullOrWhiteSpace(body))
                    {
                        continue;
                    }

                    mapped.Add($"{property.Name}. {body!.Trim()}".Trim());
                }

                return mapped;
            }

            if (value.ValueKind == JsonValueKind.String)
            {
                var text = value.GetString();
                if (!string.IsNullOrWhiteSpace(text))
                {
                    return text.Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                }
            }
        }

        return [];
    }

    /// <summary>
    /// 读答案：数组、字符串都认；判断题的「正确 / 错误」归一化成 A / B。
    /// </summary>
    private static IReadOnlyList<string> ReadAnswer(JsonElement item)
    {
        foreach (var name in new[] { "answer", "答案", "correctAnswer", "correct_answer" })
        {
            if (!item.TryGetProperty(name, out var value))
            {
                continue;
            }

            var keys = new List<string>();

            if (value.ValueKind == JsonValueKind.Array)
            {
                foreach (var element in value.EnumerateArray())
                {
                    if (element.ValueKind == JsonValueKind.String)
                    {
                        var text = element.GetString();
                        if (!string.IsNullOrWhiteSpace(text))
                        {
                            keys.Add(text.Trim());
                        }
                    }
                }
            }
            else if (value.ValueKind == JsonValueKind.String)
            {
                var text = value.GetString();
                if (!string.IsNullOrWhiteSpace(text))
                {
                    // 逗号、分号、竖线是分隔符；空格只有在「每个词都是单个字母」时
                    // 才算分隔符——「A B」是多个答案，「客户端 SYN 服务端」是一段话。
                    var tokens = text.Split(
                        [',', '，', ';', '；', '|'],
                        StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

                    if (tokens.Length == 1 && text.Contains(' '))
                    {
                        var bySpace = text.Split(
                            [' ', '\t'],
                            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

                        if (bySpace.Length > 1 && bySpace.All(t => t.Length == 1 && char.IsLetter(t[0])))
                        {
                            tokens = bySpace;
                        }
                    }

                    keys.AddRange(tokens);
                }
            }

            return keys.Select(NormalizeAnswerKey).Where(k => k.Length > 0).ToList();
        }

        return [];
    }

    /// <summary>判断题答案的「正确 / 错误」归一化成选项键。</summary>
    private static string NormalizeAnswerKey(string raw)
    {
        var text = raw.Trim();
        return text switch
        {
            "正确" or "对" or "是" or "T" or "true" or "True" or "TRUE" => "A",
            "错误" or "错" or "否" or "F" or "false" or "False" or "FALSE" => "B",
            _ => text.ToUpperInvariant(),
        };
    }

    /// <summary>读评分步骤（综合题）。</summary>
    private static IReadOnlyList<AiQuestionDraftStep> ReadSteps(JsonElement item)
    {
        if (!item.TryGetProperty("steps", out var value) || value.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var steps = new List<AiQuestionDraftStep>();
        var index = 0;

        foreach (var element in value.EnumerateArray())
        {
            index++;

            if (element.ValueKind == JsonValueKind.String)
            {
                var text = element.GetString() ?? string.Empty;
                var parts = text.Split('|', StringSplitOptions.TrimEntries);
                if (parts.Length < 2)
                {
                    continue;
                }

                decimal? score = null;
                if (parts.Length >= 3 && decimal.TryParse(parts[2], out var parsed))
                {
                    score = parsed;
                }

                steps.Add(new AiQuestionDraftStep(
                    parts[0],
                    parts[1],
                    score,
                    parts.Length >= 4 ? parts[3] : null));
                continue;
            }

            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var prompt = ReadString(element, "prompt", "text", "步骤", "说明");
            if (string.IsNullOrWhiteSpace(prompt))
            {
                continue;
            }

            steps.Add(new AiQuestionDraftStep(
                ReadString(element, "code", "编码") ?? $"s{index}",
                prompt.Trim(),
                ReadDecimal(element, "score", "分值"),
                ReadString(element, "referenceAnswer", "reference_answer", "参考答案")));
        }

        return steps;
    }
}

/// <summary>草稿解析的一条结果。</summary>
public sealed record AiQuestionDraftResult(AiQuestionDraft? Draft, string? Error)
{
    public bool Succeeded => Draft is not null;

    public static AiQuestionDraftResult Ok(AiQuestionDraft draft) => new(draft, null);

    public static AiQuestionDraftResult Failed(string error) => new(null, error);
}
