using Exam.Domain.Catalog;
using Shouldly;

namespace Exam.Domain.UnitTests.Catalog;

/// <summary>
/// 导入模板。
/// <para>
/// 模板是老师拿到手的第一份说明。它说「哪一列填什么」，解析器决定
/// 「这一列读进哪个字段」——两者必须对得上，否则老师照模板填好上传，
/// 那一列会被**静默丢掉**。
/// </para>
/// </summary>
public sealed class QuestionImportTemplateTests
{
    [Fact]
    public void 模板的表头都能被解析器认出来()
    {
        foreach (var column in QuestionImportTemplate.Columns)
        {
            QuestionImportParser.FieldAliases.ShouldContainKey(column.Header);
            QuestionImportParser.FieldAliases[column.Header].ShouldBe(column.Field);
        }
    }

    [Fact]
    public void 模板的字段都在解析器支持的字段里()
    {
        foreach (var column in QuestionImportTemplate.Columns)
        {
            QuestionImportParser.SupportedFields.ShouldContain(column.Field);
        }
    }

    [Fact]
    public void 表头顺序就是模板的列顺序()
    {
        QuestionImportTemplate.Headers.ShouldBe(
            QuestionImportTemplate.Columns.Select(c => c.Header).ToList());
    }

    [Fact]
    public void CSV第一行是表头且后面跟着示例行()
    {
        var lines = QuestionImportTemplate.ToCsv()
            .Split("\r\n", StringSplitOptions.RemoveEmptyEntries);

        lines[0].ShouldBe(string.Join(",", QuestionImportTemplate.Headers));
        lines.Length.ShouldBe(1 + QuestionImportTemplate.SampleRows.Count);
    }

    [Fact]
    public void 含逗号的单元格被引号包起来()
    {
        var csv = QuestionImportTemplate.ToCsv();

        // 示例行里的知识点是「计算机网络,TCP」——带逗号，必须转义，
        // 否则 Excel 会把它拆成两列。
        csv.ShouldContain("\"计算机网络,TCP\"");
    }

    [Fact]
    public void 必填列都有说明()
    {
        foreach (var column in QuestionImportTemplate.Columns.Where(c => c.Required))
        {
            column.Description.ShouldNotBeNullOrWhiteSpace();
            column.Description.ShouldContain("必填");
        }
    }

    [Fact]
    public void 说明里有导入前必须知道的事()
    {
        QuestionImportTemplate.Notes.ShouldNotBeEmpty();
        // 难度与知识点填的是系统里已有的标签名——这是最容易踩的坑。
        QuestionImportTemplate.Notes.Any(n => n.Contains("标签名")).ShouldBeTrue();
    }
}
