using Exam.Application.Authoring.Contracts;
using Exam.Domain.Authoring;
using Exam.Domain.Delivery;

namespace Exam.Application.Delivery.Contracts;

/// <summary>卷面里的附件引用。</summary>
public sealed record AttemptAttachmentDto(
    string ObjectKey,
    string FileName,
    string ContentType,
    long SizeBytes);

/// <summary>考生卷面里的一道题。选项按该考生的置换顺序给出。</summary>
public sealed record AttemptQuestionDto(
    long QuestionId,
    string Code,
    string Type,
    string TypeLabel,
    string Stem,
    IReadOnlyList<PaperVariantOptionDto> Options,
    decimal Score,
    string Difficulty,
    string? SectionTitle,
    IReadOnlyList<AttemptAttachmentDto> Attachments);

/// <summary>考生已作答的一题。</summary>
public sealed record AttemptAnswerDto(long QuestionId, AnswerPayload Payload, int ClientSeq);

/// <summary>作答会话的完整视图：卷面 + 已有答案 + 服务端时间。</summary>
public sealed record AttemptResponse(
    long AttemptId,
    int AttemptNo,
    string TargetType,
    string Status,
    string StatusLabel,
    DateTimeOffset ServerTime,
    DateTimeOffset? StartedAt,
    DateTimeOffset DeadlineAt,
    long RemainingSeconds,
    string VariantKey,
    ExamRulesDto Rules,
    IReadOnlyList<AttemptQuestionDto> Questions,
    IReadOnlyList<AttemptAnswerDto> Answers,
    int LastClientSeq);

/// <summary>会话摘要（我的考试列表）。</summary>
public sealed record AttemptSummaryDto(
    long Id,
    string TargetType,
    string? ExamName,
    string Status,
    string StatusLabel,
    int AttemptNo,
    DateTimeOffset? StartedAt,
    DateTimeOffset? SubmittedAt,
    DateTimeOffset DeadlineAt);

/// <summary>我的会话列表。</summary>
public sealed record AttemptListResponse(
    IReadOnlyList<AttemptSummaryDto> Items,
    int Total);

/// <summary>作答会话响应组装。</summary>
public static class AttemptResponseFactory
{
    public static AttemptResponse Build(
        Attempt attempt,
        ExamSession? session,
        Services.AttemptPaperSurface surface,
        IReadOnlyList<Answer> answers,
        DateTimeOffset serverTime) =>
        new(
            attempt.Id,
            attempt.AttemptNo,
            attempt.TargetType.ToStorage(),
            attempt.Status.ToStorage(),
            attempt.Status.Label(),
            serverTime,
            attempt.StartedAt,
            attempt.DeadlineAt,
            attempt.RemainingSeconds(serverTime),
            attempt.VariantKey ?? surface.VariantKey,
            ExamRulesDto.From(session?.Rules ?? ExamRules.Default),
            surface.Questions,
            answers
                .Select(a => new AttemptAnswerDto(a.QuestionId, a.Payload, a.ClientSeq))
                .ToList(),
            attempt.LastClientSeq);
}
