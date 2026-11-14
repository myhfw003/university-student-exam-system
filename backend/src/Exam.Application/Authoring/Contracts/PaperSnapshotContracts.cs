using Exam.Domain.Authoring;

namespace Exam.Application.Authoring.Contracts;

/// <summary>快照中的选项。</summary>
public sealed record SnapshotOptionDto(string Key, string Text);

/// <summary>快照中的评分要点。</summary>
public sealed record SnapshotKeypointDto(string Text, IReadOnlyList<string> Keywords);

/// <summary>快照中的评分步骤。</summary>
public sealed record SnapshotStepDto(
    string Code,
    string Prompt,
    string? ReferenceAnswer,
    IReadOnlyList<string> Keywords,
    decimal Score);

/// <summary>快照中的附件引用。</summary>
public sealed record SnapshotAttachmentDto(
    string ObjectKey,
    string FileName,
    string ContentType,
    long SizeBytes);

/// <summary>快照中的一道题。</summary>
public sealed record PaperSnapshotItemDto(
    long Id,
    long QuestionId,
    string QuestionCode,
    string QuestionType,
    string Stem,
    IReadOnlyList<SnapshotOptionDto> Options,
    IReadOnlyList<string> CorrectKeys,
    IReadOnlyList<SnapshotKeypointDto> Keypoints,
    IReadOnlyList<SnapshotStepDto> Steps,
    string? Analysis,
    string? ReferenceAnswer,
    IReadOnlyList<SnapshotAttachmentDto> Attachments,
    decimal Score,
    int SortOrder,
    string? SectionTitle);

/// <summary>快照摘要，不含题目正文。</summary>
public sealed record PaperSnapshotSummaryDto(
    long Id,
    long PaperId,
    int Version,
    string ContentHash,
    int ItemCount,
    decimal TotalScore,
    DateTimeOffset CreatedAt,
    long? CreatedBy);

/// <summary>快照详情，含冻结的题目内容。</summary>
public sealed record PaperSnapshotDetailDto(
    long Id,
    long PaperId,
    int Version,
    string ContentHash,
    decimal TotalScore,
    DateTimeOffset CreatedAt,
    long? CreatedBy,
    IReadOnlyList<PaperSnapshotItemDto> Items);

/// <summary>快照版本列表。</summary>
public sealed record PaperSnapshotListResponse(
    long PaperId,
    IReadOnlyList<PaperSnapshotSummaryDto> Items,
    int Total);

/// <summary>快照 DTO 组装。</summary>
public static class PaperSnapshotDtoFactory
{
    public static PaperSnapshotSummaryDto ToSummary(PaperSnapshot snapshot) => new(
        snapshot.Id,
        snapshot.PaperId,
        snapshot.SnapshotVersion,
        snapshot.ContentHash,
        snapshot.Items.Count,
        snapshot.Items.Sum(i => i.Score.Value),
        snapshot.CreatedAt,
        snapshot.CreatedBy);

    public static PaperSnapshotDetailDto ToDetail(PaperSnapshot snapshot) => new(
        snapshot.Id,
        snapshot.PaperId,
        snapshot.SnapshotVersion,
        snapshot.ContentHash,
        snapshot.Items.Sum(i => i.Score.Value),
        snapshot.CreatedAt,
        snapshot.CreatedBy,
        snapshot.Items
            .OrderBy(i => i.SortOrder)
            .Select(i => new PaperSnapshotItemDto(
                i.Id,
                i.QuestionId,
                i.QuestionCode,
                i.QuestionType,
                i.Stem,
                i.Options.Select(o => new SnapshotOptionDto(o.Key, o.Text)).ToList(),
                i.CorrectKeys.ToList(),
                i.Keypoints.Select(k => new SnapshotKeypointDto(k.Text, k.Keywords)).ToList(),
                i.Steps.Select(s => new SnapshotStepDto(
                    s.Code,
                    s.Prompt,
                    s.ReferenceAnswer,
                    s.Keywords,
                    s.Score)).ToList(),
                i.Analysis,
                i.ReferenceAnswer,
                i.Attachments.Select(a => new SnapshotAttachmentDto(
                    a.ObjectKey,
                    a.FileName,
                    a.ContentType,
                    a.SizeBytes)).ToList(),
                i.Score.Value,
                i.SortOrder,
                i.SectionTitle))
            .ToList());
}
