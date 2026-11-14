using Exam.Domain.Catalog;

namespace Exam.Domain.Authoring;

/// <summary>派生卷面中的一道题。</summary>
public sealed record VariantItem(
    long QuestionId,
    QuestionType QuestionType,
    IReadOnlyList<string> OptionOrder,
    int SortOrder);

/// <summary>
/// 派生卷面。题序与每题选项的显示顺序都定下来了。
/// <para>
/// 服务端下发卷面时只给「选项显示顺序」，正确答案始终留在服务端——
/// 置换的是卷面，不是答案。
/// </para>
/// </summary>
public sealed record VariantPaper(
    string VariantKey,
    VariantRule Rule,
    IReadOnlyList<VariantItem> Items);

/// <summary>
/// 卷面派生器（领域服务）。
/// <para>
/// 标准卷：题序与选项都不动。
/// 小梅花：题序不动，每题选项按考生打乱（判断题不打乱）。
/// 大梅花：题型块顺序保留，块内题序打乱，选项同小梅花。
/// </para>
/// <para>
/// 确定性：同 (studentKey, sessionSeed) 必得同一卷面——重进考场不会换卷。</para>
/// </summary>
public static class PaperVariantBuilder
{
    /// <summary>标准卷的卷面标识。</summary>
    public const string StandardVariantKey = "STD";

    /// <summary>
    /// 由快照派生卷面。
    /// </summary>
    /// <param name="snapshot">已发布的试卷快照。</param>
    /// <param name="rule">卷型规则。</param>
    /// <param name="studentKey">考生标识。</param>
    /// <param name="sessionSeed">场次种子。</param>
    public static VariantPaper Build(
        PaperSnapshot snapshot,
        VariantRule rule,
        string studentKey,
        string sessionSeed)
    {
        ArgumentNullException.ThrowIfNull(snapshot);

        var source = snapshot.Items.OrderBy(i => i.SortOrder).ToList();

        if (rule == VariantRule.Standard)
        {
            return new VariantPaper(
                StandardVariantKey,
                rule,
                source.Select((item, index) => ToVariantItem(item, index, keepOptionOrder: true)).ToList());
        }

        var ordered = rule == VariantRule.LargePlum
            ? ShuffleWithinTypeBlocks(source, studentKey, sessionSeed)
            : source;

        var items = new List<VariantItem>();
        for (var index = 0; index < ordered.Count; index++)
        {
            items.Add(ToVariantItem(ordered[index], index, keepOptionOrder: false, studentKey, sessionSeed));
        }

        return new VariantPaper(
            DeriveVariantKey(studentKey, sessionSeed),
            rule,
            items);
    }

    /// <summary>派生卷面的标识：同一考生同一场次必得同一个。</summary>
    public static string DeriveVariantKey(string studentKey, string sessionSeed) =>
        $"VP-{Hash($"{studentKey}|{sessionSeed}"):x8}";

    private static VariantItem ToVariantItem(
        SnapshotItem item,
        int index,
        bool keepOptionOrder,
        string? studentKey = null,
        string? sessionSeed = null)
    {
        var type = QuestionTypes.FromStorage(item.QuestionType) ?? QuestionType.Single;
        var keys = item.Options
            .OrderBy(o => o.Key, StringComparer.Ordinal)
            .Select(o => o.Key)
            .ToList();

        // 判断题只有「正确 / 错误」两个固定选项，置换没有意义，也不该置换。
        if (keepOptionOrder || type == QuestionType.Judge || keys.Count < 2)
        {
            return new VariantItem(item.QuestionId, type, keys, index);
        }

        var seed = Hash($"{item.QuestionId}|{studentKey}|{sessionSeed}");
        return new VariantItem(item.QuestionId, type, Shuffle(keys, seed), index);
    }

    /// <summary>大梅花：题型块顺序保留，块内题序打乱。</summary>
    private static List<SnapshotItem> ShuffleWithinTypeBlocks(
        List<SnapshotItem> source,
        string studentKey,
        string sessionSeed)
    {
        var blocks = new List<(QuestionType Type, List<SnapshotItem> Items)>();

        foreach (var item in source)
        {
            var type = QuestionTypes.FromStorage(item.QuestionType) ?? QuestionType.Single;
            var block = blocks.FirstOrDefault(b => b.Type == type);
            if (block.Items is null)
            {
                blocks.Add((type, [item]));
            }
            else
            {
                block.Items.Add(item);
            }
        }

        var result = new List<SnapshotItem>();
        foreach (var block in blocks)
        {
            var seed = Hash($"{block.Type}|{studentKey}|{sessionSeed}");
            result.AddRange(Shuffle(block.Items, seed));
        }

        return result;
    }

    private static List<T> Shuffle<T>(IReadOnlyList<T> source, uint seed)
    {
        var list = source.ToList();
        var state = seed;

        for (var i = list.Count - 1; i > 0; i--)
        {
            var j = (int)(Next(ref state) % (uint)(i + 1));
            (list[i], list[j]) = (list[j], list[i]);
        }

        return list;
    }

    /// <summary>FNV-1a 32 位哈希，跨进程一致。</summary>
    private static uint Hash(string value)
    {
        var hash = 2166136261u;
        foreach (var c in value)
        {
            hash ^= c;
            hash *= 16777619u;
        }

        return hash;
    }

    /// <summary>mulberry32 伪随机数发生器。</summary>
    private static uint Next(ref uint state)
    {
        state += 0x6D2B79F5u;
        var t = state;
        t = (t ^ (t >> 15)) * (t | 1u);
        t ^= t + ((t ^ (t >> 7)) * (t | 61u));
        return t ^ (t >> 14);
    }
}
