using Exam.Domain.Delivery;

namespace Exam.Application.Delivery.Contracts;

/// <summary>综合题的分步作答输入。</summary>
public sealed record AnswerStepInput(string? Code, string? Text);

/// <summary>答案载荷输入。</summary>
public sealed record AnswerPayloadInput(
    IReadOnlyList<string>? SelectedOptionKeys,
    string? Text,
    IReadOnlyList<AnswerStepInput>? Steps)
{
    /// <summary>转成领域载荷。选项键去重并排序，保证同一份答案只有一种写法。</summary>
    public AnswerPayload ToPayload() => new()
    {
        SelectedOptionKeys = (SelectedOptionKeys ?? [])
            .Where(k => !string.IsNullOrWhiteSpace(k))
            .Select(k => k.Trim().ToUpperInvariant())
            .Distinct(StringComparer.Ordinal)
            .OrderBy(k => k, StringComparer.Ordinal)
            .ToList(),
        Text = string.IsNullOrWhiteSpace(Text) ? null : Text.Trim(),
        Steps = (Steps ?? [])
            .Where(s => !string.IsNullOrWhiteSpace(s.Code))
            .Select(s => new AnswerStep(s.Code!.Trim(), s.Text?.Trim() ?? string.Empty))
            .ToList(),
    };
}

/// <summary>一条待保存的答案。</summary>
public sealed record SaveAnswerItemInput(long QuestionId, AnswerPayloadInput Payload);

/// <summary>批量保存请求。</summary>
public sealed record SaveAnswersInput(
    int ClientSeq,
    IReadOnlyList<SaveAnswerItemInput> Items,
    DateTimeOffset? ClientSentAt = null);

/// <summary>被拒绝的答案及原因。</summary>
public sealed record RejectedAnswerDto(long QuestionId, string Reason);

/// <summary>批量保存结果。</summary>
public sealed record SaveAnswersResponse(
    int AcceptedClientSeq,
    DateTimeOffset ServerTime,
    long RemainingSeconds,
    IReadOnlyList<RejectedAnswerDto> Rejected);
