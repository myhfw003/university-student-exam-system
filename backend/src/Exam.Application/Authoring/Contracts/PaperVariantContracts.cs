using Exam.Domain.Authoring;
using Exam.Domain.Catalog;

namespace Exam.Application.Authoring.Contracts;

/// <summary>派生卷面里的一个选项。</summary>
public sealed record PaperVariantOptionDto(string Key, string Text);

/// <summary>派生卷面里的一道题。选项按显示顺序给出。</summary>
public sealed record PaperVariantItemDto(
    long QuestionId,
    string QuestionCode,
    string Type,
    string TypeLabel,
    string Stem,
    IReadOnlyList<PaperVariantOptionDto> Options,
    decimal Score,
    int SortOrder,
    string? SectionTitle);

/// <summary>派生卷面。</summary>
public sealed record PaperVariantDto(
    string VariantKey,
    string Rule,
    string RuleLabel,
    int ItemCount,
    decimal TotalScore,
    IReadOnlyList<PaperVariantItemDto> Items);

/// <summary>派生卷面 DTO 组装。</summary>
public static class PaperVariantDtoFactory
{
    public static PaperVariantDto ToDto(PaperSnapshot snapshot, VariantPaper variant)
    {
        var items = variant.Items
            .Select(item =>
            {
                var source = snapshot.Items.First(s => s.QuestionId == item.QuestionId);
                var options = source.Options
                    .OrderBy(o => o.Key, StringComparer.Ordinal)
                    .ToDictionary(o => o.Key, o => o.Text);

                return new PaperVariantItemDto(
                    item.QuestionId,
                    source.QuestionCode,
                    QuestionTypes.ToStorage(item.QuestionType),
                    item.QuestionType.Label(),
                    source.Stem,
                    item.OptionOrder.Select(key => new PaperVariantOptionDto(key, options[key])).ToList(),
                    source.Score.Value,
                    item.SortOrder,
                    source.SectionTitle);
            })
            .ToList();

        return new PaperVariantDto(
            variant.VariantKey,
            VariantRules.ToStorage(variant.Rule),
            variant.Rule.Label(),
            items.Count,
            items.Sum(i => i.Score),
            items);
    }
}
