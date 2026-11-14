using System.Globalization;
using System.IO.Compression;
using System.Text;
using Exam.Application.Common.Interfaces;
using Exam.Domain.SharedKernel.Exceptions;
using ClosedXML.Excel;
using CsvHelper;
using CsvHelper.Configuration;

namespace Exam.Infrastructure.Identity;

/// <summary>
/// 试题文件解析器。CSV 与 XLSX 都读成同一张表。
/// <para>
/// 安全约束：文件大小、行数、列数都有上限；XLSX 额外检查压缩包展开后的
/// 总体积，避免「压缩炸弹」把内存打满。
/// </para>
/// </summary>
public sealed class QuestionFileParser : IQuestionFileParser
{
    /// <summary>文件大小上限：20 MB。</summary>
    public const int MaxFileSizeBytes = 20 * 1024 * 1024;

    /// <summary>行数上限。</summary>
    public const int MaxRows = 20000;

    /// <summary>列数上限。</summary>
    public const int MaxColumns = 50;

    /// <summary>XLSX 解压后总体积上限：200 MB。</summary>
    public const long MaxUncompressedBytes = 200L * 1024 * 1024;

    static QuestionFileParser()
    {
        // GB18030 等旧代码页在 .NET Core 上默认不可用，必须显式注册。
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    public QuestionFileTable Parse(byte[] content, string fileName)
    {
        if (content.Length == 0)
        {
            throw new BusinessRuleException("文件是空的。");
        }

        if (content.Length > MaxFileSizeBytes)
        {
            throw new BusinessRuleException($"文件超过 {MaxFileSizeBytes / 1024 / 1024} MB 上限。");
        }

        return IsXlsx(content, fileName)
            ? ParseXlsx(content)
            : ParseCsv(content);
    }

    /// <summary>XLSX 是 zip 包，magic 是 "PK"。</summary>
    private static bool IsXlsx(byte[] content, string fileName)
    {
        if (content.Length >= 4 && content[0] == 0x50 && content[1] == 0x4B)
        {
            return true;
        }

        return Path.GetExtension(fileName).Equals(".xlsx", StringComparison.OrdinalIgnoreCase);
    }

    private static QuestionFileTable ParseCsv(byte[] content)
    {
        var text = Decode(content);

        using var reader = new StringReader(text);
        using var csv = new CsvReader(reader, new CsvConfiguration(CultureInfo.InvariantCulture)
        {
            HasHeaderRecord = true,
            TrimOptions = TrimOptions.Trim,
            MissingFieldFound = null,
            BadDataFound = null,
            DetectColumnCountChanges = false,
        });

        if (!csv.Read() || !csv.ReadHeader())
        {
            throw new BusinessRuleException("文件缺少表头，无法识别列。");
        }

        var headers = (csv.HeaderRecord ?? [])
            .Select(h => h?.Trim() ?? string.Empty)
            .ToList();

        if (headers.Count > MaxColumns)
        {
            throw new BusinessRuleException($"列数超过 {MaxColumns} 上限。");
        }

        var rows = new List<IReadOnlyList<string?>>();
        while (csv.Read())
        {
            if (rows.Count >= MaxRows)
            {
                throw new BusinessRuleException($"行数超过 {MaxRows} 上限。");
            }

            var cells = new List<string?>(headers.Count);
            for (var i = 0; i < headers.Count; i++)
            {
                cells.Add(csv.TryGetField<string>(i, out var value) ? value : null);
            }

            rows.Add(cells);
        }

        return new QuestionFileTable(headers, rows);
    }

    private static QuestionFileTable ParseXlsx(byte[] content)
    {
        EnsureArchiveSizeIsSane(content);

        using var buffer = new MemoryStream(content);
        using var workbook = new XLWorkbook(buffer);

        var sheet = workbook.Worksheets.FirstOrDefault()
            ?? throw new BusinessRuleException("工作簿里没有任何工作表。");

        var used = sheet.RangeUsed();
        if (used is null)
        {
            return new QuestionFileTable([], []);
        }

        var lastRow = used.LastRow().RowNumber();
        var lastColumn = used.LastColumn().ColumnNumber();

        if (lastColumn > MaxColumns)
        {
            throw new BusinessRuleException($"列数超过 {MaxColumns} 上限。");
        }

        var dataRows = lastRow - 1;
        if (dataRows > MaxRows)
        {
            throw new BusinessRuleException($"行数超过 {MaxRows} 上限。");
        }

        var headers = new List<string>(lastColumn);
        for (var column = 1; column <= lastColumn; column++)
        {
            headers.Add(sheet.Cell(1, column).GetString().Trim());
        }

        var rows = new List<IReadOnlyList<string?>>(dataRows);
        for (var row = 2; row <= lastRow; row++)
        {
            var cells = new List<string?>(lastColumn);
            for (var column = 1; column <= lastColumn; column++)
            {
                cells.Add(sheet.Cell(row, column).GetString().Trim());
            }

            rows.Add(cells);
        }

        return new QuestionFileTable(headers, rows);
    }

    /// <summary>检查 xlsx 压缩包展开后的总体积，避免压缩炸弹。</summary>
    private static void EnsureArchiveSizeIsSane(byte[] content)
    {
        try
        {
            using var archive = new ZipArchive(new MemoryStream(content), ZipArchiveMode.Read);
            long total = 0;

            foreach (var entry in archive.Entries)
            {
                total += entry.Length;
                if (total > MaxUncompressedBytes)
                {
                    throw new BusinessRuleException(
                        $"文件解压后超过 {MaxUncompressedBytes / 1024 / 1024} MB 上限，已拒绝。");
                }
            }
        }
        catch (InvalidDataException)
        {
            throw new BusinessRuleException("文件不是有效的 xlsx 格式。");
        }
    }

    /// <summary>识别编码：优先 UTF-8（含 BOM），其次 GB18030。</summary>
    private static string Decode(byte[] content)
    {
        if (content.Length >= 3 && content[0] == 0xEF && content[1] == 0xBB && content[2] == 0xBF)
        {
            return Encoding.UTF8.GetString(content, 3, content.Length - 3);
        }

        try
        {
            return new UTF8Encoding(false, throwOnInvalidBytes: true).GetString(content);
        }
        catch (DecoderFallbackException)
        {
            return Encoding.GetEncoding("GB18030").GetString(content);
        }
    }
}
