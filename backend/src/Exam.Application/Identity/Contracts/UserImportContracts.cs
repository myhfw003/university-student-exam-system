namespace Exam.Application.Identity.Contracts;

/// <summary>导入失败的行。</summary>
public sealed record UserImportFailure(int RowNumber, string? Username, string Reason);

/// <summary>导入时生成的初始密码。管理员据此把密码发给学生。</summary>
public sealed record UserImportGeneratedPassword(string Username, string Password);

/// <summary>学生名单导入结果。</summary>
public sealed record UserImportResult(
    int Total,
    int Succeeded,
    int Created,
    int Updated,
    IReadOnlyList<UserImportFailure> Failed,
    IReadOnlyList<UserImportGeneratedPassword> GeneratedPasswords);
