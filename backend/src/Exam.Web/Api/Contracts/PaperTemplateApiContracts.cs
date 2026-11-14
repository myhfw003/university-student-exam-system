namespace Exam.Web.Api.Contracts;

/// <summary>由试卷另存为模板。</summary>
public sealed record CreatePaperTemplateRequest(long PaperId, string? Name);

/// <summary>把模板套用到目标试卷。</summary>
public sealed record ApplyPaperTemplateRequest(long PaperId);
