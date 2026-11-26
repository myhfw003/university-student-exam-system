using Exam.Domain.Catalog;

namespace Exam.Application.Catalog.Services;

/// <summary>
/// 给模型的提示词。
/// <para>
/// 提示词是**供应商无关**的：所有实现都拿同一段文字去问模型，
/// 输出格式也由这里定死，解析侧照着这个格式读。
/// </para>
/// </summary>
public static class AiQuestionPrompt
{
    /// <summary>系统提示词：说清要什么、输出成什么格式、遵守哪些规则。</summary>
    public const string SystemPrompt = """
        你是高校课程的命题助手。按给定的题型、难度与知识点出题。

        只输出一个 JSON 对象，不要写任何解释、前后缀或 Markdown 代码块。格式：
        {"questions":[{"stem":"题干","type":"single","options":["A. 选项甲","B. 选项乙"],"answer":["A"],"analysis":"答案解析","referenceAnswer":"参考答案","score":5,"steps":[{"code":"s1","prompt":"作答提示","score":5,"referenceAnswer":"参考答案"}]}]}

        规则：
        1. type 只能是 single、multi、judge、short、comprehensive。
        2. 单选题（single）：至少 4 个选项，answer 恰好一个选项键。
        3. 多选题（multi）：至少 4 个选项，answer 至少两个选项键。
        4. 判断题（judge）：options 固定为 ["A. 正确","B. 错误"]，answer 为 "A"（命题成立）或 "B"（命题不成立）。
        5. 简答题（short）：不写 options；answer 写参考答案全文，referenceAnswer 与之相同。
        6. 综合题（comprehensive）：不写 options；steps 至少两步，每步都要有 code、prompt、score、referenceAnswer；各步 score 之和必须等于题目 score。
        7. 题干里不能出现「答案」「正确答案」「正确选项」「下列说法正确」这类泄题词，也不要写「4 个选项」这类出题痕迹；干扰选项要似是而非。
        8. score 是 1 到 40 的数字；单选、多选、判断默认 5 分。
        9. 题干末尾不要加括号说明，例如下面这些都是错的：
           「……（　　）（答案 B，4 个选项）」「……（答案：B）」「……（4 个选项）」。
        """;

    /// <summary>把生成请求拼成给模型的用户消息。</summary>
    public static string BuildUserPrompt(AiGenerationRequest request)
    {
        var lines = new List<string>
        {
            $"出题要求：{request.Prompt}",
            $"题型：{Describe(request.Type)}",
            $"难度：{request.DifficultyName}",
            $"题量：{request.Count} 道",
        };

        if (request.KnowledgePointNames.Count > 0)
        {
            lines.Add($"知识点：{string.Join("、", request.KnowledgePointNames)}");
        }

        return string.Join("\n", lines);
    }

    /// <summary>题型的中文说法，给模型看更直观。</summary>
    public static string Describe(QuestionType type) => type switch
    {
        QuestionType.Single => "单选题",
        QuestionType.Multi => "多选题",
        QuestionType.Judge => "判断题",
        QuestionType.Short => "简答题",
        QuestionType.Comprehensive => "综合题",
        _ => type.ToString(),
    };
}
