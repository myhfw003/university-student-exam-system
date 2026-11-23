namespace Exam.Application.Identity.Contracts;

/// <summary>导入失败的行。</summary>
public sealed record UserImportFailure(int RowNumber, string? Username, string Reason);

/// <summary>学生名单导入结果。</summary>
/// <para>
/// **响应里没有任何密码**：CSV 没给密码的账号置为**系统设定的原始密码**，
/// 由管理员另行告知用户。
/// </para>
/// </summary>
public sealed record UserImportResult(
    int Total,
    int Succeeded,
    int Created,
    int Updated,
    IReadOnlyList<UserImportFailure> Failed);
