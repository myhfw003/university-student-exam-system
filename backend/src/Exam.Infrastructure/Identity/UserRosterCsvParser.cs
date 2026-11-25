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
/// 列名同时接受中文与英文，词表见 <see cref="Columns"/>：账号 / 姓名 / 学院 / 专业 /
/// 班级 / 邮箱 / 角色 / 初始密码，以及 account / name / faculty / major / class /
/// email / role / password。
/// </para>
/// <para>
/// 词表与前端 <c>frontend/shared/src/mock/roster.ts</c> 的 COLUMN_KEYWORDS 是**同一套词**，
/// <c>scripts/check-roster-columns.py</c> 会比对两边，漂了 CI 就红。
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

    /// <summary>
    /// 列名词表：标准字段 → 可接受的表头关键词。**顺序即匹配优先级**。
    /// <para>
    /// 一列只会被认领一次，所以「username」不会被「name」抢走，「初始密码」也不会
    /// 被「密码」抢走。与前端 roster.ts 的 COLUMN_KEYWORDS 保持逐字一致。
    /// </para>
    /// </summary>
    internal static readonly (string Field, string[] Keywords)[] Columns =
    [
        ("account", ["账号", "帐号", "学号", "工号", "用户名", "登录账号", "account", "username"]),
        ("name", ["姓名", "名字", "name"]),
        ("faculty", ["院系", "学院", "faculty", "college", "department"]),
        ("major", ["专业", "major"]),
        ("className", ["班级", "班", "class"]),
        ("email", ["邮箱", "邮件", "email"]),
        ("role", ["角色", "身份", "role"]),
        ("password", ["初始密码", "密码", "password"]),
    ];

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
        var mapping = MapColumns(headers);

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
                Get(mapping, csv, "className"),
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

    /// <summary>
    /// 按词表把表头映射到标准字段。
    /// <para>
    /// 逐个字段找列：先找**完全相等**的表头，找不到再找**包含**关键词的表头；
    /// 一列被认领后不再给别的字段用。与前端 roster.ts 的算法一致。
    /// </para>
    /// </summary>
    internal static Dictionary<string, int> MapColumns(IReadOnlyList<string?> headers)
    {
        var mapping = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var used = new bool[headers.Count];

        foreach (var (field, keywords) in Columns)
        {
            var index = FindHeader(headers, used, keywords, exact: true);
            if (index < 0)
            {
                index = FindHeader(headers, used, keywords, exact: false);
            }

            if (index >= 0)
            {
                mapping[field] = index;
                used[index] = true;
            }
        }

        return mapping;
    }

    private static int FindHeader(
        IReadOnlyList<string?> headers,
        bool[] used,
        string[] keywords,
        bool exact)
    {
        for (var i = 0; i < headers.Count; i++)
        {
            if (used[i])
            {
                continue;
            }

            var header = headers[i]?.Trim();
            if (string.IsNullOrEmpty(header))
            {
                continue;
            }

            var hit = keywords.Any(keyword => exact
                ? string.Equals(header, keyword, StringComparison.OrdinalIgnoreCase)
                : header.Contains(keyword, StringComparison.OrdinalIgnoreCase));

            if (hit)
            {
                return i;
            }
        }

        return -1;
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
