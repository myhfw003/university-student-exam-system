namespace Exam.Application.Learning.Contracts;

/// <summary>一项能力上的掌握情况。</summary>
public sealed record AbilityProfileDto(
    long AbilityTagId,
    string TagName,
    decimal MasteryRate,
    int SampleSize,
    int CorrectCount,
    bool SampleSufficient,
    string MasteryLabel);

/// <summary>能力画像。</summary>
public sealed record AbilityProfileResponse(
    IReadOnlyList<AbilityProfileDto> Items,
    int Total,
    int InsufficientCount);
