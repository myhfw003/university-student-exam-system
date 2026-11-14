using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.Delivery;

namespace Exam.Domain.Grading;

/// <summary>单选题判分：选项完全一致才得分。</summary>
public sealed class SingleChoiceScoringStrategy : IScoringStrategy
{
    public QuestionType SupportedType => QuestionType.Single;

    public ScoringOutcome Score(AnswerPayload answer, PaperItem item, SnapshotItem question)
    {
        var max = item.Score.Value;
        var selected = answer.SelectedOptionKeys;
        var correct = question.CorrectKeys;

        if (selected.Count == 0)
        {
            return new ScoringOutcome(0m, max, ScoringMethod.AutoScored, ScoringStatus.AutoScored, ["未作答"]);
        }

        if (selected.Count != 1)
        {
            return new ScoringOutcome(0m, max, ScoringMethod.AutoScored, ScoringStatus.AutoScored, ["单选题只能有一个选项"]);
        }

        var isCorrect = selected.Count == correct.Count
            && selected.All(correct.Contains);

        return isCorrect
            ? new ScoringOutcome(max, max, ScoringMethod.AutoScored, ScoringStatus.AutoScored, ["答对"])
            : new ScoringOutcome(0m, max, ScoringMethod.AutoScored, ScoringStatus.AutoScored, [$"答错，选了 {string.Join("、", selected)}"]);
    }
}

/// <summary>
/// 判断题判分。判断题固定「正确 / 错误」两个选项，置换没有意义，
/// 因此比较的是**原始选项键**。
/// </summary>
public sealed class JudgeScoringStrategy : IScoringStrategy
{
    public QuestionType SupportedType => QuestionType.Judge;

    public ScoringOutcome Score(AnswerPayload answer, PaperItem item, SnapshotItem question)
    {
        var max = item.Score.Value;
        var selected = answer.SelectedOptionKeys;
        var correct = question.CorrectKeys;

        if (selected.Count == 0)
        {
            return new ScoringOutcome(0m, max, ScoringMethod.AutoScored, ScoringStatus.AutoScored, ["未作答"]);
        }

        var isCorrect = selected.Count == correct.Count
            && selected.All(correct.Contains);

        return isCorrect
            ? new ScoringOutcome(max, max, ScoringMethod.AutoScored, ScoringStatus.AutoScored, ["答对"])
            : new ScoringOutcome(0m, max, ScoringMethod.AutoScored, ScoringStatus.AutoScored, [$"答错，选了 {string.Join("、", selected)}"]);
    }
}

/// <summary>
/// 多选题判分。
/// <para>错选一律 0 分；只漏选按命中比例折半；全对满分。</para>
/// </summary>
public sealed class MultipleChoiceScoringStrategy : IScoringStrategy
{
    public QuestionType SupportedType => QuestionType.Multi;

    public ScoringOutcome Score(AnswerPayload answer, PaperItem item, SnapshotItem question)
    {
        var max = item.Score.Value;
        var selected = answer.SelectedOptionKeys.ToHashSet(StringComparer.Ordinal);
        var correct = question.CorrectKeys.ToHashSet(StringComparer.Ordinal);

        if (selected.Count == 0)
        {
            return new ScoringOutcome(0m, max, ScoringMethod.AutoScored, ScoringStatus.AutoScored, ["未作答"]);
        }

        var wrong = selected.Except(correct).ToList();
        if (wrong.Count > 0)
        {
            return new ScoringOutcome(0m, max, ScoringMethod.AutoScored, ScoringStatus.AutoScored, [$"错选 {string.Join("、", wrong)}"]);
        }

        var hit = selected.Intersect(correct).Count();
        if (hit == correct.Count)
        {
            return new ScoringOutcome(max, max, ScoringMethod.AutoScored, ScoringStatus.AutoScored, ["全对"]);
        }

        // 漏选折半：满分 × 命中比例 × 0.5。
        var raw = max * hit / correct.Count * 0.5m;
        var score = RoundToStep(raw);

        return new ScoringOutcome(
            score,
            max,
            ScoringMethod.AutoScored,
            ScoringStatus.AutoScored,
            [$"漏选，命中 {hit}/{correct.Count}"]);
    }

    /// <summary>分数按 0.5 步进取整，与阅卷给分对齐。</summary>
    internal static decimal RoundToStep(decimal value) =>
        Math.Round(value / Exam.Domain.Catalog.Score.GradingStep, MidpointRounding.AwayFromZero)
        * Exam.Domain.Catalog.Score.GradingStep;
}

/// <summary>
/// 简答题判分：逐要点判定，要点关键词全部命中才算该要点得分。
/// <para>产出建议分，等人工确认。</para>
/// </summary>
public sealed class ShortAnswerScoringStrategy : IScoringStrategy
{
    public QuestionType SupportedType => QuestionType.Short;

    public ScoringOutcome Score(AnswerPayload answer, PaperItem item, SnapshotItem question)
    {
        var max = item.Score.Value;
        var keypoints = question.Keypoints;
        var text = answer.Text ?? string.Empty;

        if (keypoints.Count == 0)
        {
            return new ScoringOutcome(0m, max, ScoringMethod.AutoSuggested, ScoringStatus.Suggested, ["卷面未配置评分要点"]);
        }

        var details = new List<string>();
        var hit = 0;

        foreach (var keypoint in keypoints)
        {
            var keywords = keypoint.Keywords.Count > 0
                ? keypoint.Keywords
                : [keypoint.Text];

            var matched = AnswerTextNormalizer.ContainsAll(text, keywords);
            if (matched)
            {
                hit++;
                details.Add($"✓ {keypoint.Text}");
            }
            else
            {
                details.Add($"○ {keypoint.Text}");
            }
        }

        var score = MultipleChoiceScoringStrategy.RoundToStep(max * hit / keypoints.Count);

        return new ScoringOutcome(score, max, ScoringMethod.AutoSuggested, ScoringStatus.Suggested, details);
    }
}

/// <summary>
/// 综合题判分：逐步骤判定，按命中步骤分占比折算。
/// <para>产出建议分，等人工确认。</para>
/// </summary>
public sealed class ComprehensiveScoringStrategy : IScoringStrategy
{
    public QuestionType SupportedType => QuestionType.Comprehensive;

    public ScoringOutcome Score(AnswerPayload answer, PaperItem item, SnapshotItem question)
    {
        var max = item.Score.Value;
        var steps = question.Steps;

        if (steps.Count == 0)
        {
            return new ScoringOutcome(0m, max, ScoringMethod.AutoSuggested, ScoringStatus.Suggested, ["卷面未配置评分步骤"]);
        }

        var details = new List<string>();
        var hitScore = 0m;
        var totalStepScore = 0m;

        foreach (var step in steps)
        {
            totalStepScore += step.Score;

            var studentText = answer.Steps
                .FirstOrDefault(s => string.Equals(s.Code, step.Code, StringComparison.Ordinal))?.Text
                ?? answer.Text
                ?? string.Empty;

            var keywords = step.Keywords.Count > 0
                ? step.Keywords
                : string.IsNullOrWhiteSpace(step.ReferenceAnswer) ? [] : [step.ReferenceAnswer];

            var matched = keywords.Count > 0 && AnswerTextNormalizer.ContainsAll(studentText, keywords);
            if (matched)
            {
                hitScore += step.Score;
                details.Add($"✓ {step.Code}");
            }
            else
            {
                details.Add($"○ {step.Code}");
            }
        }

        var score = totalStepScore <= 0m
            ? 0m
            : MultipleChoiceScoringStrategy.RoundToStep(max * hitScore / totalStepScore);

        return new ScoringOutcome(score, max, ScoringMethod.AutoSuggested, ScoringStatus.Suggested, details);
    }
}
