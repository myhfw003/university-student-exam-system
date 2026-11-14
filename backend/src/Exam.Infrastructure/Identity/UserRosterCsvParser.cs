using System.Globalization;
using System.Text;
using Exam.Application.Common.Interfaces;
using Exam.Domain.SharedKernel.Exceptions;
using CsvHelper;
using CsvHelper.Configuration;

namespace Exam.Infrastructure.Identity;

/// <summary>
/// 学生名单 CSV 解析器。
/// <para>
/// 列名同时接受中文与英文：账号 / 姓名 / 学院 / 专业 / 班级 / 邮箱 / 角色 / 密码，
/// 以及 account / name / faculty / major / class / email / role / password。
/// </para>
/// <para>
/// 编码自动识别：UTF-8 带 BOM、UTF-8 无 BOM、GB18030（国内 Excel 默认导出）。
/// </para>
/// </summary>
public sealed class UserRosterCsvParser : IUserRosterParser
{
    private const int MaxRows = 20000;

    static UserRosterCsvParser()
    {
        // GB18030 等旧代码页在 .NET Core 上默认不可用，必须显式注册。
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    /// <summary>列名别名 → 标准字段名。</summary>
    private static readonly Dictionary<string, string> ColumnAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["账号"] = "account",
        ["学号"] = "account",
        ["登录账号"] = "account",
        ["account"] = "account",
        ["username"] = "account",
        ["姓名"] = "name",
        ["名字"] = "name",
        ["name"] = "name",
        ["学院"] = "faculty",
        ["院系"] = "faculty",
        ["faculty"] = "faculty",
        ["department"] = "faculty",
        ["专业"] = "major",
        ["major"] = "major",
        ["班级"] = "class",
        ["class"] = "class",
        ["邮箱"] = "email",
        ["email"] = "email",
        ["角色"] = "role",
        ["role"] = "role",
        ["密码"] = "password",
        ["password"] = "password",
    };

    public IReadOnlyList<UserRosterRow> Parse(byte[] content, string fileName)
    {
        if (content.Length == 0)
        {
            throw new BusinessRuleException("名单文件是空的。");
        }

        var text = Decode(content);

        var rows = new List<UserRosterRow>();
        var lineNumber = 1;

        using var reader = new StringReader(text);
        using var csv = new CsvReader(reader, new CsvConfiguration(CultureInfo.InvariantCulture)
        {
            HasHeaderRecord = true,
            TrimOptions = TrimOptions.Trim,
            MissingFieldFound = null,
            BadDataFound = null,
            // 真实名单常有列数不齐的行：缺列按空处理，多列忽略，不因此中断整批。
            DetectColumnCountChanges = false,
        });

        if (!csv.Read() || !csv.ReadHeader())
        {
            throw new BusinessRuleException("名单文件缺少表头，无法识别列。");
        }

        var headers = csv.HeaderRecord ?? [];
        var mapping = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < headers.Length; i++)
        {
            var header = headers[i]?.Trim();
            if (string.IsNullOrEmpty(header))
            {
                continue;
            }

            if (ColumnAliases.TryGetValue(header, out var canonical))
            {
                mapping[canonical] = i;
            }
        }

        if (!mapping.ContainsKey("account"))
        {
            throw new BusinessRuleException("名单文件缺少「账号」列（也可用 account / 学号）。");
        }

        if (!mapping.ContainsKey("name"))
        {
            throw new BusinessRuleException("名单文件缺少「姓名」列（也可用 name）。");
        }

        while (ReadRow(csv))
        {
            lineNumber++;
            if (rows.Count >= MaxRows)
            {
                throw new BusinessRuleException($"名单行数超过上限 {MaxRows} 行。");
            }

            var row = new UserRosterRow(
                lineNumber,
                Get(mapping, csv, "account"),
                Get(mapping, csv, "name"),
                Get(mapping, csv, "faculty"),
                Get(mapping, csv, "major"),
                Get(mapping, csv, "class"),
                Get(mapping, csv, "email"),
                Get(mapping, csv, "role"),
                Get(mapping, csv, "password"));

            // 全空行直接跳过，不算作错误行。
            if (IsBlank(row))
            {
                continue;
            }

            rows.Add(row);
        }

        return rows;
    }

    /// <summary>读一行。行结构损坏时跳过该行，不中断整批。</summary>
    private static bool ReadRow(CsvReader csv)
    {
        try
        {
            return csv.Read();
        }
        catch (BadDataException)
        {
            return false;
        }
    }

    private static bool IsBlank(UserRosterRow row) =>
        string.IsNullOrWhiteSpace(row.Account)
        && string.IsNullOrWhiteSpace(row.Name)
        && string.IsNullOrWhiteSpace(row.Faculty)
        && string.IsNullOrWhiteSpace(row.Major)
        && string.IsNullOrWhiteSpace(row.Class)
        && string.IsNullOrWhiteSpace(row.Email)
        && string.IsNullOrWhiteSpace(row.Role);

    private static string? Get(IReadOnlyDictionary<string, int> mapping, CsvReader csv, string field) =>
        mapping.TryGetValue(field, out var index) ? NullIfBlank(csv.GetField(index)) : null;

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

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
            // 国内 Excel 默认导出 GB18030，按它再试一次。
            return Encoding.GetEncoding("GB18030").GetString(content);
        }
    }
}
