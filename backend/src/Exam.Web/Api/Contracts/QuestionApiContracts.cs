using Exam.Application.Catalog.Contracts;

namespace Exam.Web.Api.Contracts;

public sealed record CreateQuestionRequest(
    string Code,
    string Type,
    string Stem,
    decimal DefaultScore,
    IReadOnlyList<long>? TagIds,
    long DifficultyTagId,
    IReadOnlyList<QuestionOptionInput>? Options,
    IReadOnlyList<QuestionKeypointInput>? Keypoints,
    IReadOnlyList<QuestionStepInput>? Steps,
    string? Analysis,
    string? ReferenceAnswer);

public sealed record UpdateQuestionRequest(
    string? Code,
    string? Type,
    string Stem,
    decimal DefaultScore,
    IReadOnlyList<long>? TagIds,
    long DifficultyTagId,
    IReadOnlyList<QuestionOptionInput>? Options,
    IReadOnlyList<QuestionKeypointInput>? Keypoints,
    IReadOnlyList<QuestionStepInput>? Steps,
    string? Analysis,
    string? ReferenceAnswer);

public sealed record BatchQuestionStatusRequest(
    IReadOnlyList<long> QuestionIds,
    string TargetStatus);

public sealed record CreateQuestionBankRequest(string Name, string? Description);

public sealed record UpdateQuestionBankRequest(string Name, string? Description);

public sealed record QuestionBankItemsRequest(IReadOnlyList<long> QuestionIds);
