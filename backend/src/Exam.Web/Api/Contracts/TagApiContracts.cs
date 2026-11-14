namespace Exam.Web.Api.Contracts;

public sealed record CreateTagRequest(
    string Code,
    string Name,
    string Group,
    long? ParentId,
    int? Level,
    string? Description,
    int SortOrder);

public sealed record UpdateTagRequest(
    string Name,
    long? ParentId,
    int? Level,
    string? Description,
    int SortOrder);
