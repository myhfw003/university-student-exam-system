using Exam.Domain.Catalog;

namespace Exam.Application.Catalog.Contracts;

/// <summary>导入模板里的一列。</summary>
public sealed record ImportTemplateColumnDto(
    string Field,
    string Header,
    bool Required,
    string Description,
    string Example);

/// <summary>
/// 导入模板。
/// <para>
/// 一份数据两处用：<c>csv</c> 供老师下载填写，
/// <c>columns</c> / <c>notes</c> 供界面上把「要长什么样」直接讲清楚。
/// </para>
/// </summary>
public sealed record ImportTemplateDto(
    string FileName,
    string Csv,
    IReadOnlyList<ImportTemplateColumnDto> Columns,
    IReadOnlyList<string> Notes)
{
    /// <summary>由领域里的模板定义组装。</summary>
    public static ImportTemplateDto FromTemplate() => new(
        "试题导入模板.csv",
        // 带 BOM：Excel 打开 UTF-8 的 CSV 不带 BOM 会把中文显示成乱码。
        "\\uFEFF" + QuestionImportTemplate.ToCsv(),
        QuestionImportTemplate.Columns
            .Select(c => new ImportTemplateColumnDto(c.Field, c.Header, c.Required, c.Description, c.Example))
            .ToList(),
        QuestionImportTemplate.Notes);
}
