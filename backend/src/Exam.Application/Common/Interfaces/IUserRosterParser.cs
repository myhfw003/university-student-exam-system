namespace Exam.Application.Common.Interfaces;

/// <summary>学生名单的一行。</summary>
/// <param name="RowNumber">行号，从 2 开始（第 1 行是表头）。</param>
public sealed record UserRosterRow(
    int RowNumber,
    string? Account,
    string? Name,
    string? Faculty,
    string? Major,
    string? Class,
    string? Email,
    string? Role,
    string? Password);

/// <summary>
/// 学生名单解析器。实现位于 Infrastructure。
/// <para>解析只负责「把文件读成行」，业务校验在应用与领域层。</para>
/// </summary>
public interface IUserRosterParser
{
    /// <summary>解析 CSV 内容。无法解析文件结构时抛出带中文提示的异常。</summary>
    IReadOnlyList<UserRosterRow> Parse(byte[] content, string fileName);
}
