namespace Exam.Application.Catalog.Contracts;

/// <summary>选项输入。</summary>
public sealed record QuestionOptionInput(string Key, string Text, bool IsCorrect);

/// <summary>评分要点输入。</summary>
public sealed record QuestionKeypointInput(string Text, IReadOnlyList<string> Keywords);

/// <summary>评分步骤输入。</summary>
public sealed record QuestionStepInput(
    string Code,
    string Prompt,
    string? ReferenceAnswer,
    IReadOnlyList<string> Keywords,
    decimal Score);
