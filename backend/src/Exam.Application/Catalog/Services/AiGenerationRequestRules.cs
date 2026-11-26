using Exam.Domain.Catalog;

namespace Exam.Application.Catalog.Services;

/// <summary>
/// AI 生成请求的校验规则。
/// <para>
/// **流式与非流式两个入口共用这一份**：规则写在两处必然漂移——
/// 流式入口漏了「一次最多 10 道」，就等于给了模型一个不受限的出题量。
/// </para>
/// </summary>
public static class AiGenerationRequestRules
{
    /// <summary>一次最多生成几道。</summary>
    public const int MaxCount = 10;

    /// <summary>出题要求最长多少字。</summary>
    public const int MaxPromptLength = 2000;

    /// <summary>
    /// 校验请求。返回字段级错误（空字典表示通过）。
    /// <para>
    /// 字段名与错误文案是前后端共用的契约：同一个问题，
    /// 流式与非流式必须报同一句话，否则老师会以为是两个功能。
    /// </para>
    /// </summary>
    public static IReadOnlyDictionary<string, string[]> Validate(
        string? provider,
        int count,
        string? type,
        long difficultyTagId,
        IReadOnlyList<long>? tagIds,
        string? prompt)
    {
        var errors = new Dictionary<string, List<string>>(StringComparer.Ordinal);

        void Add(string field, string message)
        {
            if (!errors.TryGetValue(field, out var list))
            {
                list = [];
                errors[field] = list;
            }

            list.Add(message);
        }

        if (string.IsNullOrWhiteSpace(provider))
        {
            Add("Provider", "请选择 AI 供应商。");
        }

        if (count is < 1 or > MaxCount)
        {
            Add("Count", $"一次最多生成 {MaxCount} 道题。");
        }

        if (QuestionTypes.FromName(type) is null && QuestionTypes.FromStorage(type) is null)
        {
            Add("Type", "题型无法识别。");
        }

        if (difficultyTagId <= 0)
        {
            Add("DifficultyTagId", "请选择难度标签。");
        }

        if (string.IsNullOrWhiteSpace(prompt))
        {
            Add("Prompt", "请填写出题要求。");
        }
        else if (prompt.Length > MaxPromptLength)
        {
            Add("Prompt", "出题要求过长。");
        }

        if (tagIds is not null && tagIds.Distinct().Count() > Question.MaxTagCount)
        {
            Add("TagIds", $"知识点标签不能超过 {Question.MaxTagCount} 个。");
        }

        return errors.ToDictionary(
            pair => pair.Key,
            pair => pair.Value.ToArray(),
            StringComparer.Ordinal);
    }
}
