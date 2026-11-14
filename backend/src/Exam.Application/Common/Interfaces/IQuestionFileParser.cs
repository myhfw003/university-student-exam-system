namespace Exam.Application.Common.Interfaces;

/// <summary>从文件里读出来的一张表。</summary>
/// <param name="Headers">表头列名。</param>
/// <param name="Rows">数据行，每行按表头顺序给出单元格文本。</param>
public sealed record QuestionFileTable(
    IReadOnlyList<string> Headers,
    IReadOnlyList<IReadOnlyList<string?>> Rows);

/// <summary>
/// 试题文件解析器。实现位于 Infrastructure（CSV / XLSX）。
/// <para>只负责把文件读成表；业务解析（列映射、题型校验）在领域层。</para>
/// </summary>
public interface IQuestionFileParser
{
    /// <summary>
    /// 解析文件。无法识别格式或超出保护上限时抛出带中文提示的异常。
    /// </summary>
    QuestionFileTable Parse(byte[] content, string fileName);
}
