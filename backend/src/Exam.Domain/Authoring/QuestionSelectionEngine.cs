using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Authoring;

/// <summary>
/// 候选题目。抽题引擎只看得到抽题需要的信息，
/// 不依赖题目聚合本身，便于纯函数式地测试与复现。
/// </summary>
public sealed record QuestionCandidate(
    long QuestionId,
    string Code,
    QuestionType Type,
    long DifficultyTagId,
    int DifficultyLevel,
    string DifficultyName);

/// <summary>抽中的一道题及其卷面分值。</summary>
public sealed record SelectedQuestion(
    long QuestionId,
    QuestionType Type,
    long DifficultyTagId,
    int DifficultyLevel,
    string DifficultyName,
    decimal Score,
    int SortOrder);

/// <summary>抽题结果。</summary>
public sealed record SelectionPlan(IReadOnlyList<SelectedQuestion> Items, decimal TotalScore);

/// <summary>
/// 抽题引擎（领域服务）。
/// <para>
/// 确定性保证：同 Rules + 同 Seed + 同题池 → 完全相同的题位列表。
/// 题池不足时逐条列出缺口并抛异常，<b>绝不降级补题</b>。
/// </para>
/// </summary>
public static class QuestionSelectionEngine
{
    /// <summary>
    /// 按规则抽题。
    /// </summary>
    /// <param name="rules">组卷规则。</param>
    /// <param name="pool">候选题池（已按已发布、标签、难度过滤）。</param>
    /// <param name="seed">确定性随机种子。</param>
    /// <exception cref="InsufficientQuestionPoolException">题池不足。</exception>
    public static SelectionPlan Generate(
        BlueprintRules rules,
        IReadOnlyList<QuestionCandidate> pool,
        string seed)
    {
        rules.EnsureValid();

        if (string.IsNullOrWhiteSpace(seed))
        {
            throw new BusinessRuleException("随机种子不能为空。");
        }

        // 1. 稳定基序：按题号升序，后续所有打乱都在这个基序上进行。
        var sorted = pool.OrderBy(c => c.QuestionId).ToList();
        var levels = BuildDifficultyLevels(sorted);
        var cells = BuildCells(rules, levels);
        var shortfalls = new List<Shortfall>();
        var picks = new List<Picked>();

        // 2. 逐 cell 抽取。
        foreach (var cell in cells)
        {
            var candidates = sorted.Where(c => cell.Matches(c)).ToList();
            var shuffled = Shuffle(candidates, CellSeed(seed, cell));

            if (shuffled.Count < cell.Required)
            {
                shortfalls.Add(new Shortfall
                {
                    Type = cell.Type,
                    DifficultyTagId = cell.DifficultyTagId,
                    DifficultyName = cell.DifficultyName,
                    Required = cell.Required,
                    Available = shuffled.Count,
                    Reason = BuildShortfallReason(rules, cell, shuffled.Count),
                });
                continue;
            }

            foreach (var candidate in shuffled.Take(cell.Required))
            {
                picks.Add(new Picked(candidate, cell));
            }
        }

        // 3. 池量不足：逐条列出缺口，不降级、不替代。
        if (shortfalls.Count > 0)
        {
            throw new InsufficientQuestionPoolException(
                "以下配额无法满足，请调整规则或补充题目。",
                shortfalls);
        }

        // 4. 分值分配。
        var cellTotals = AllocateCellTotals(rules, cells);
        var scored = new List<Scored>();
        foreach (var cell in cells)
        {
            var cellPicks = picks.Where(p => p.Cell.Index == cell.Index).ToList();
            if (cellPicks.Count == 0)
            {
                continue;
            }

            var cellTotal = cellTotals[cell.Index];
            IReadOnlyList<decimal> scores;

            if (rules.ScoreAllocation == ScoreAllocation.ByDifficulty && cell.DifficultyTagId is null)
            {
                // 未限定难度时，cell 内按难度权重分摊；同难度的题权重相同。
                var weights = cellPicks
                    .Select(p => Math.Max(1, p.Candidate.DifficultyLevel))
                    .ToList();
                scores = ScoreAllocator.Allocate(cellTotal, weights, null, Score.MaxQuestionScore);
            }
            else
            {
                scores = ScoreAllocator.AllocateEven(cellTotal, cellPicks.Count, null, Score.MaxQuestionScore);
            }

            for (var i = 0; i < cellPicks.Count; i++)
            {
                var pick = cellPicks[i];
                scored.Add(new Scored(
                    pick.Candidate,
                    scores[i],
                    cell.Index,
                    pick.Candidate.DifficultyLevel));
            }
        }

        // 5. 题序：按题型分组或按抽取顺序。
        var ordered = rules.OrderRule == OrderRule.ByType
            ? scored
                .OrderBy(s => TypeOrder(s.Candidate.Type))
                .ThenBy(s => s.Candidate.DifficultyLevel)
                .ThenBy(s => s.CellIndex)
                .ToList()
            : scored.OrderBy(s => s.CellIndex).ToList();

        var items = ordered
            .Select((s, index) => new SelectedQuestion(
                s.Candidate.QuestionId,
                s.Candidate.Type,
                s.Candidate.DifficultyTagId,
                s.Candidate.DifficultyLevel,
                s.Candidate.DifficultyName,
                s.Score,
                index))
            .ToList();

        return new SelectionPlan(items, items.Sum(i => i.Score));
    }

    /// <summary>题型的固定顺序：单选 → 多选 → 判断 → 简答 → 综合操作。</summary>
    public static int TypeOrder(QuestionType type)
    {
        var order = QuestionTypes.All;
        var index = order.ToList().IndexOf(type);
        return index < 0 ? order.Count : index;
    }

    /// <summary>配额矩阵中的一个格子。</summary>
    private sealed record Cell(
        int Index,
        QuestionType? Type,
        long? DifficultyTagId,
        string DifficultyName,
        int DifficultyLevel,
        int Required)
    {
        public bool Matches(QuestionCandidate candidate) =>
            (Type is null || candidate.Type == Type)
            && (DifficultyTagId is null || candidate.DifficultyTagId == DifficultyTagId);
    }

    private sealed record Picked(QuestionCandidate Candidate, Cell Cell);

    private sealed record Scored(QuestionCandidate Candidate, decimal Score, int CellIndex, int DifficultyLevel);

    /// <summary>按难度标签 ID 汇总难度等级，取候选题里出现过的最大值。</summary>
    private static Dictionary<long, int> BuildDifficultyLevels(IReadOnlyList<QuestionCandidate> pool)
    {
        var levels = new Dictionary<long, int>();
        foreach (var candidate in pool)
        {
            if (!levels.TryGetValue(candidate.DifficultyTagId, out var level)
                || candidate.DifficultyLevel > level)
            {
                levels[candidate.DifficultyTagId] = candidate.DifficultyLevel;
            }
        }

        return levels;
    }

    /// <summary>
    /// 计算配额矩阵。题型配额与难度配额都给出时，按比例交叉分配，
    /// 并保证两个方向的合计都精确等于配额。
    /// </summary>
    private static List<Cell> BuildCells(BlueprintRules rules, IReadOnlyDictionary<long, int> levels)
    {
        var difficultyName = (long id) => levels.ContainsKey(id) ? id.ToString() : id.ToString();

        if (rules.DifficultyQuota.Count > 0 && rules.TypeQuota.Count > 0)
        {
            var matrix = BuildMatrix(rules);
            var cells = new List<Cell>();
            var index = 0;

            foreach (var type in QuestionTypes.All.Where(t => rules.TypeQuota.ContainsKey(t)))
            {
                foreach (var difficulty in rules.DifficultyQuota.Keys.OrderBy(id => id))
                {
                    var required = matrix[(type, difficulty)];
                    if (required <= 0)
                    {
                        continue;
                    }

                    cells.Add(new Cell(
                        index++,
                        type,
                        difficulty,
                        difficultyName(difficulty),
                        levels.TryGetValue(difficulty, out var level) ? level : int.MaxValue,
                        required));
                }
            }

            return cells;
        }

        if (rules.TypeQuota.Count > 0)
        {
            var cells = new List<Cell>();
            var index = 0;
            foreach (var type in QuestionTypes.All.Where(t => rules.TypeQuota.ContainsKey(t)))
            {
                cells.Add(new Cell(index++, type, null, "不限难度", 0, rules.TypeQuota[type]));
            }

            return cells;
        }

        var difficultyCells = new List<Cell>();
        var difficultyIndex = 0;
        foreach (var difficulty in rules.DifficultyQuota.Keys.OrderBy(id => id))
        {
            difficultyCells.Add(new Cell(
                difficultyIndex++,
                null,
                difficulty,
                difficultyName(difficulty),
                levels.TryGetValue(difficulty, out var level) ? level : int.MaxValue,
                rules.DifficultyQuota[difficulty]));
        }

        return difficultyCells;
    }

    /// <summary>
    /// 题型 × 难度的交叉配额。
    /// <para>
    /// 先按「剩余难度配额」的比例把每个题型的名额分下去，再把列（难度）的合计修正到配额值——
    /// 修正只在同一行内挪动名额，因此行合计（题型配额）始终不变。
    /// </para>
    /// </summary>
    private static Dictionary<(QuestionType, long), int> BuildMatrix(BlueprintRules rules)
    {
        var types = QuestionTypes.All.Where(t => rules.TypeQuota.ContainsKey(t)).ToList();
        var difficulties = rules.DifficultyQuota.Keys.OrderBy(id => id).ToList();

        var matrix = new Dictionary<(QuestionType, long), int>();
        foreach (var type in types)
        {
            foreach (var difficulty in difficulties)
            {
                matrix[(type, difficulty)] = 0;
            }
        }

        var remaining = difficulties.ToDictionary(d => d, d => rules.DifficultyQuota[d]);

        foreach (var type in types)
        {
            var need = rules.TypeQuota[type];
            var totalRemaining = remaining.Values.Sum();
            if (totalRemaining <= 0)
            {
                break;
            }

            var raw = difficulties.ToDictionary(
                d => d,
                d => (decimal)need * remaining[d] / totalRemaining);

            var take = raw.ToDictionary(kv => kv.Key, kv => (int)Math.Floor(kv.Value));
            var assigned = take.Values.Sum();

            // 余数按小数部分从大到小补齐，同小数按难度标签 ID 升序，保证确定性。
            var order = difficulties
                .OrderByDescending(d => raw[d] - Math.Floor(raw[d]))
                .ThenBy(d => d)
                .ToList();

            var cursor = 0;
            var guard = 0;
            while (assigned < need && guard++ < difficulties.Count * 4)
            {
                var difficulty = order[cursor % order.Count];
                cursor++;
                take[difficulty]++;
                assigned++;
            }

            foreach (var difficulty in difficulties)
            {
                matrix[(type, difficulty)] = take[difficulty];
                remaining[difficulty] -= take[difficulty];
            }
        }

        RepairColumns(matrix, types, difficulties, rules);
        return matrix;
    }

    /// <summary>把各难度列的合计修正到难度配额，行合计保持不变。</summary>
    private static void RepairColumns(
        Dictionary<(QuestionType, long), int> matrix,
        IReadOnlyList<QuestionType> types,
        IReadOnlyList<long> difficulties,
        BlueprintRules rules)
    {
        var guard = 0;
        while (guard++ < 1000)
        {
            var over = difficulties.Where(d => ColumnSum(matrix, types, d) > rules.DifficultyQuota[d]).ToList();
            var under = difficulties.Where(d => ColumnSum(matrix, types, d) < rules.DifficultyQuota[d]).ToList();

            if (over.Count == 0 || under.Count == 0)
            {
                return;
            }

            var source = over[0];
            var target = under[0];

            // 在同一行内挪一个名额：行合计不变，两列的合计各差一个。
            var rows = types.Where(t => matrix[(t, source)] > 0).ToList();
            if (rows.Count == 0)
            {
                return;
            }

            matrix[(rows[0], source)]--;
            matrix[(rows[0], target)]++;
        }
    }

    private static int ColumnSum(
        Dictionary<(QuestionType, long), int> matrix,
        IReadOnlyList<QuestionType> types,
        long difficulty) =>
        types.Sum(t => matrix[(t, difficulty)]);

    /// <summary>
    /// 把目标总分分摊到各个 cell。以 0.5 为单位用最大余数法分配，
    /// 保证各 cell 合计精确等于目标总分。
    /// </summary>
    private static decimal[] AllocateCellTotals(BlueprintRules rules, IReadOnlyList<Cell> cells)
    {
        var totalUnits = (int)Math.Round(rules.TargetTotalScore / ScoreAllocator.Step, MidpointRounding.AwayFromZero);
        var totalRequired = cells.Sum(c => c.Required);
        if (totalRequired <= 0)
        {
            return cells.Select(_ => 0m).ToArray();
        }

        var weights = cells
            .Select(c => rules.ScoreAllocation == ScoreAllocation.ByDifficulty
                ? Math.Max(1, c.DifficultyLevel == int.MaxValue ? 1 : c.DifficultyLevel) * c.Required
                : c.Required)
            .ToList();

        var weightSum = weights.Aggregate(0L, (acc, w) => acc + w);
        var raw = weights.Select(w => (decimal)totalUnits * w / weightSum).ToList();
        var units = raw.Select(v => (int)Math.Floor(v)).ToList();
        var assigned = units.Sum();

        var order = weights
            .Select((w, i) => (Index: i, Fraction: raw[i] - Math.Floor(raw[i])))
            .OrderByDescending(x => x.Fraction)
            .ThenBy(x => x.Index)
            .ToList();

        var cursor = 0;
        while (assigned < totalUnits && cursor < order.Count * 4)
        {
            units[order[cursor % order.Count].Index]++;
            assigned++;
            cursor++;
        }

        return units.Select(u => u * ScoreAllocator.Step).ToArray();
    }

    /// <summary>缺口原因说明，直接写给教师看。</summary>
    private static string BuildShortfallReason(BlueprintRules rules, Cell cell, int available)
    {
        var typeText = cell.Type is null ? "任意题型" : QuestionTypes.ToStorage(cell.Type.Value);
        var difficultyText = cell.DifficultyTagId is null ? "任意难度" : $"难度[{cell.DifficultyTagId}]";

        var tagText = rules.TagSelector.IsEmpty
            ? string.Empty
            : $"标签[{string.Join(",", rules.TagSelector.TagIds)}]{(rules.TagSelector.IncludeDescendants ? "（含子标签）" : string.Empty)}且";

        return $"题库中同时满足{tagText}{difficultyText}的{typeText}题仅有 {available} 道";
    }

    /// <summary>cell 的确定性洗牌种子。</summary>
    private static uint CellSeed(string seed, Cell cell)
    {
        var key = cell.Type is null
            ? $"d:{cell.DifficultyTagId?.ToString() ?? "-"}"
            : cell.DifficultyTagId is null
                ? $"t:{(int)cell.Type.Value}"
                : $"t:{(int)cell.Type.Value}:d:{cell.DifficultyTagId}";

        return Hash($"{seed}|{key}");
    }

    /// <summary>FNV-1a 32 位哈希，保证跨进程、跨平台一致。</summary>
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

    /// <summary>确定性洗牌（Fisher-Yates + mulberry32）。</summary>
    private static List<QuestionCandidate> Shuffle(IReadOnlyList<QuestionCandidate> source, uint seed)
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
