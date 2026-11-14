using System.Text.Json;
using System.Text.Json.Serialization;
using Exam.Application.Common.Interfaces;
using Exam.Domain.Catalog;

namespace Exam.Application.Catalog.Services;

/// <summary>解析完成并已解析标签引用的一道题。落库前用它创建题目聚合。</summary>
public sealed record ResolvedQuestion(
    string? Code,
    QuestionType Type,
    string Stem,
    decimal Score,
    string? Analysis,
    string? ReferenceAnswer,
    IReadOnlyList<ParsedOption> Options,
    IReadOnlyList<ParsedKeypoint> Keypoints,
    IReadOnlyList<ParsedStep> Steps,
    long DifficultyTagId,
    IReadOnlyList<long> TagIds);

/// <summary>一行的解析结果。</summary>
public sealed record ImportRowParseResult(
    int RowNumber,
    string Raw,
    string? Parsed,
    IReadOnlyList<ImportRowError> Errors)
{
    public bool IsValid => Errors.Count == 0;
}

/// <summary>
/// 导入行处理器。把「文件里的一行」翻译成「一道题」，并解析标签引用。
/// </summary>
public sealed class QuestionImportRowProcessor
{
    /// <summary>解析结果的 JSON 序列化选项。</summary>
    public static JsonSerializerOptions JsonOptions { get; } = CreateJsonOptions();

    private readonly ITagRepository _tags;

    public QuestionImportRowProcessor(ITagRepository tags) => _tags = tags;

    /// <summary>根据表头猜测列映射。猜不出来的列不映射，管理员可以手工指定。</summary>
    public static IReadOnlyDictionary<string, string> SuggestMapping(IReadOnlyList<string> headers)
    {
        var mapping = new Dictionary<string, string>(StringComparer.Ordinal);
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var header in headers)
        {
            if (string.IsNullOrWhiteSpace(header))
            {
                continue;
            }

            if (!QuestionImportParser.FieldAliases.TryGetValue(header.Trim(), out var canonical))
            {
                continue;
            }

            if (!used.Add(canonical))
            {
                continue;
            }

            mapping[canonical] = header.Trim();
        }

        return mapping;
    }

    /// <summary>按列映射解析全部行。</summary>
    public async Task<IReadOnlyList<ImportRowParseResult>> ParseAsync(
        QuestionFileTable table,
        IReadOnlyDictionary<string, string> mapping,
        CancellationToken cancellationToken)
    {
        var indexByField = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < table.Headers.Count; i++)
        {
            var header = table.Headers[i];
            if (string.IsNullOrWhiteSpace(header))
            {
                continue;
            }

            if (!indexByField.TryGetValue(header.Trim(), out var index))
            {
                indexByField[header.Trim()] = i;
            }
        }

        var results = new List<ImportRowParseResult>(table.Rows.Count);

        foreach (var (row, rowIndex) in table.Rows.Select((row, index) => (row, index)))
        {
            var rowNumber = rowIndex + 2;
            var raw = JsonSerializer.Serialize(
                table.Headers.Select((header, index) => new
                {
                    Header = header,
                    Value = index < row.Count ? row[index] : null,
                }),
                JsonOptions);

            var values = new Dictionary<string, string?>(StringComparer.Ordinal);
            foreach (var (field, header) in mapping)
            {
                if (!indexByField.TryGetValue(header, out var index))
                {
                    values[field] = null;
                    continue;
                }

                values[field] = index < row.Count ? row[index] : null;
            }

            var (parsed, errors) = QuestionImportParser.Parse(values);

            if (parsed is not null)
            {
                var (resolved, resolveErrors) = await ResolveReferencesAsync(parsed, cancellationToken);
                errors = errors.Concat(resolveErrors).ToList();

                if (resolveErrors.Count == 0 && resolved is not null)
                {
                    parsed = null;
                    var json = JsonSerializer.Serialize(resolved, JsonOptions);
                    results.Add(new ImportRowParseResult(rowNumber, raw, json, errors));
                    continue;
                }
            }

            results.Add(new ImportRowParseResult(rowNumber, raw, null, errors));
        }

        return results;
    }

    /// <summary>解析难度标签与知识点标签的引用。找不到的标签算作行错误。</summary>
    private async Task<(ResolvedQuestion? Resolved, IReadOnlyList<ImportRowError> Errors)> ResolveReferencesAsync(
        ParsedQuestion parsed,
        CancellationToken cancellationToken)
    {
        var errors = new List<ImportRowError>();

        var difficultyTag = await ResolveDifficultyAsync(parsed.DifficultyName, cancellationToken);
        if (difficultyTag is null)
        {
            errors.Add(new ImportRowError(
                "difficulty",
                string.IsNullOrWhiteSpace(parsed.DifficultyName)
                    ? "必须指定难度标签。请调整列映射，或在文件中补充难度列。"
                    : $"难度标签不存在：{parsed.DifficultyName}。请先在标签管理中创建，或调整列映射。"));
        }

        var tagIds = new List<long>();
        if (parsed.TagNames.Count > 0)
        {
            var tags = await _tags.GetByNamesAsync(parsed.TagNames, null, cancellationToken);
            var byName = tags.GroupBy(t => t.Name, StringComparer.Ordinal)
                .ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);

            foreach (var name in parsed.TagNames)
            {
                if (byName.TryGetValue(name, out var tag))
                {
                    if (tag.Group == TagGroup.Organization)
                    {
                        errors.Add(new ImportRowError("tags", $"组织维度的标签「{name}」不能挂到题目上。"));
                    }
                    else
                    {
                        tagIds.Add(tag.Id);
                    }
                }
                else
                {
                    errors.Add(new ImportRowError("tags", $"标签不存在：{name}。请先在标签管理中创建，或调整列映射。"));
                }
            }
        }

        if (errors.Count > 0)
        {
            return (null, errors);
        }

        return (
            new ResolvedQuestion(
                parsed.Code,
                parsed.Type,
                parsed.Stem,
                parsed.Score,
                parsed.Analysis,
                parsed.ReferenceAnswer,
                parsed.Options,
                parsed.Keypoints,
                parsed.Steps,
                difficultyTag!.Id,
                tagIds),
            errors);
    }

    /// <summary>难度可以给名称（基础 / 中等）也可以给等级（1..5）。</summary>
    private async Task<Tag?> ResolveDifficultyAsync(string? difficultyName, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(difficultyName))
        {
            return null;
        }

        var trimmed = difficultyName.Trim();

        var byName = await _tags.GetByNamesAsync([trimmed], TagGroup.Difficulty, cancellationToken);
        var tag = byName.FirstOrDefault();
        if (tag is not null)
        {
            return tag;
        }

        if (int.TryParse(trimmed, out var level) && level >= 1 && level <= 5)
        {
            var difficulties = await _tags.ListAsync(TagGroup.Difficulty, cancellationToken);
            return difficulties.FirstOrDefault(t => t.Level == level);
        }

        return null;
    }

    private static JsonSerializerOptions CreateJsonOptions()
    {
        var options = new JsonSerializerOptions { WriteIndented = false };
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }
}
