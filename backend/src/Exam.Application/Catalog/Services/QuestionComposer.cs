using Exam.Domain.Catalog;

namespace Exam.Application.Catalog.Services;

/// <summary>
/// 把「解析好的题目内容」组装成领域里的草稿题。
/// <para>
/// 文件导入与大模型生成走的是同一条组装路径：两条路进来的内容最终都要变成
/// 同一道题，规则只写一遍——判断题固定两个选项、综合题的分值与评分步骤都在
/// 这里定，免得两处各写一套、越走越偏。
/// </para>
/// </summary>
public static class QuestionComposer
{
    /// <summary>组装一道草稿题（不落库）。</summary>
    public static Question Compose(
        ParsedQuestion parsed,
        string code,
        long difficultyTagId,
        IReadOnlyList<long> tagIds,
        QuestionSource source,
        long? batchId,
        DateTimeOffset now,
        long? actorId)
    {
        var question = Question.CreateDraft(
            code,
            parsed.Type,
            parsed.Stem,
            Score.Question(parsed.Score),
            difficultyTagId,
            now,
            actorId,
            source,
            batchId);

        question.UpdateContent(
            parsed.Stem,
            parsed.Analysis,
            parsed.ReferenceAnswer,
            Score.Question(parsed.Score),
            now,
            actorId);

        AddOptions(question, parsed, now, actorId);

        foreach (var keypoint in parsed.Keypoints)
        {
            question.AddKeypoint(
                QuestionKeypoint.Create(keypoint.Text, keypoint.Keywords, 0),
                now,
                actorId);
        }

        foreach (var step in parsed.Steps)
        {
            // 步骤的参考答案要带过来：综合题发布时要求每一步都有参考答案，
            // 丢了它这道题就永远发布不了。
            question.AddStep(
                QuestionStep.Create(
                    step.Code,
                    step.Prompt,
                    step.ReferenceAnswer,
                    [],
                    Score.Question(step.Score),
                    0),
                now,
                actorId);
        }

        foreach (var tagId in tagIds)
        {
            question.AttachTag(tagId, now, actorId);
        }

        return question;
    }

    /// <summary>
    /// 把「标签已解析」的导入结果还原成解析结果。
    /// <para>标签与难度在导入那步已经查过库了，这里只取内容部分。</para>
    /// </summary>
    public static ParsedQuestion FromResolved(ResolvedQuestion resolved) => new(
        resolved.Code,
        resolved.Type,
        resolved.Stem,
        resolved.Score,
        resolved.Analysis,
        resolved.ReferenceAnswer,
        resolved.Options,
        resolved.Keypoints,
        resolved.Steps,
        [],
        null);

    private static void AddOptions(
        Question question,
        ParsedQuestion parsed,
        DateTimeOffset now,
        long? actorId)
    {
        if (parsed.Type == QuestionType.Judge)
        {
            // 判断题的两个选项由聚合根固定创建（A 正确 / B 错误，且默认 A 是正确项）。
            // 答案判「错误」时正确项要换到 B：先清空再按答案键重建。
            var correctKey = parsed.Options.FirstOrDefault(o => o.IsCorrect)?.Key ?? "A";
            question.ClearOptions(now, actorId);
            question.AddOption(QuestionOption.Create("A", "正确", correctKey == "A", 0), now, actorId);
            question.AddOption(QuestionOption.Create("B", "错误", correctKey == "B", 1), now, actorId);
            return;
        }

        var order = 0;
        foreach (var option in parsed.Options)
        {
            question.AddOption(
                QuestionOption.Create(option.Key, option.Text, option.IsCorrect, order),
                now,
                actorId);
            order++;
        }
    }
}
