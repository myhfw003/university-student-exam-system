using Exam.Domain.Catalog;

namespace Exam.Application.Catalog.Services;

/// <summary>一次生成请求的参数（命令与服务共用）。</summary>
public sealed record AiGenerationParameters(
    string Provider,
    string? Model,
    int Count,
    QuestionType Type,
    long DifficultyTagId,
    IReadOnlyList<long> TagIds,
    string Prompt);
