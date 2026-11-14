using System.Security.Cryptography;
using System.Text;
using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Authoring;

/// <summary>快照里的选项。</summary>
public sealed record SnapshotOption(string Key, string Text);

/// <summary>快照里的评分要点。</summary>
public sealed record SnapshotKeypoint(string Text, IReadOnlyList<string> Keywords);

/// <summary>快照里的评分步骤。</summary>
public sealed record SnapshotStep(
    string Code,
    string Prompt,
    string? ReferenceAnswer,
    IReadOnlyList<string> Keywords,
    decimal Score);

/// <summary>快照里的附件引用。</summary>
public sealed record SnapshotAttachment(string ObjectKey, string FileName, string ContentType, long SizeBytes);

/// <summary>
/// 试卷快照。发布时冻结内容，**不可变**。
/// <para>
/// 题目之后被修改或停用，都不影响已生成的快照——这是「已发布内容稳定」的基础。
/// </para>
/// </summary>
public sealed class PaperSnapshot : AuditableEntity
{
    private readonly List<SnapshotItem> _items = [];

    private PaperSnapshot()
    {
    }

    private PaperSnapshot(
        long paperId,
        int version,
        string contentHash,
        AnswerPolicy answerPolicy,
        DateTimeOffset now,
        long? actorId)
        : base(now, actorId)
    {
        PaperId = paperId;
        SnapshotVersion = version;
        ContentHash = contentHash;
        AnswerPolicy = answerPolicy;
    }

    public long PaperId { get; private set; }

    /// <summary>
    /// 快照版本号。同一试卷递增。
    /// <para>不叫 <c>Version</c> 是因为基类的 <c>Version</c> 是 xmin 乐观并发令牌。</para>
    /// </summary>
    public int SnapshotVersion { get; private set; }

    /// <summary>内容哈希，用于变更检测。</summary>
    public string ContentHash { get; private set; } = string.Empty;

    /// <summary>
    /// 答案公布策略。发布时冻结：考完之后改试卷，也改不动这场考试什么时候公布答案。
    /// </summary>
    public AnswerPolicy AnswerPolicy { get; private set; } = AnswerPolicy.AfterClose;

    public IReadOnlyCollection<SnapshotItem> Items => _items.AsReadOnly();

    /// <summary>按发布时的内容冻结快照。</summary>
    public static PaperSnapshot Create(
        Paper paper,
        IReadOnlyList<Question> questions,
        int version,
        DateTimeOffset now,
        long? actorId = null)
    {
        var byId = questions.ToDictionary(q => q.Id);
        var snapshot = new PaperSnapshot(paper.Id, version, string.Empty, paper.AnswerPolicy, now, actorId);

        foreach (var item in paper.Items.OrderBy(i => i.SortOrder))
        {
            if (!byId.TryGetValue(item.QuestionId, out var question))
            {
                continue;
            }

            snapshot._items.Add(SnapshotItem.Create(
                question,
                item.Score,
                item.SortOrder,
                paper.Sections.FirstOrDefault(s => s.Id == item.SectionId)?.Title,
                now));
        }

        snapshot.ContentHash = ComputeHash(paper, snapshot._items);
        return snapshot;
    }

    /// <summary>内容哈希：只覆盖影响卷面的内容，不含创建时间。</summary>
    private static string ComputeHash(Paper paper, IEnumerable<SnapshotItem> items)
    {
        var builder = new StringBuilder();
        builder.Append(paper.Id).Append('|').Append(paper.TotalItemScore).Append('|');
        builder.Append(paper.TargetTotalScore.Value).Append('|');
        builder.Append(paper.AnswerPolicy.ToStorage()).Append('|');

        foreach (var item in items.OrderBy(i => i.SortOrder))
        {
            builder.Append(item.QuestionId).Append(':')
                .Append(item.Score.Value).Append(':')
                .Append(item.QuestionType).Append(':')
                .Append(item.QuestionCode).Append(':')
                .Append(item.Stem).Append(':')
                .Append(item.Analysis).Append(':')
                .Append(item.ReferenceAnswer).Append(':')
                .Append(string.Join(",", item.Options.Select(o => o.Key + o.Text)))
                .Append(':')
                .Append(string.Join(",", item.CorrectKeys))
                .Append(':')
                .Append(string.Join(",", item.Keypoints.Select(k => k.Text)))
                .Append(':')
                .Append(string.Join(",", item.Steps.Select(s => s.Code + s.Prompt + s.Score)))
                .Append(';');
        }

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(builder.ToString())));
    }
}

/// <summary>快照中的一道题。内容在创建时冻结，之后不再变化。</summary>
public sealed class SnapshotItem : Entity<long>
{
    public SnapshotItem()
    {
    }

    private SnapshotItem(
        long questionId,
        string questionCode,
        string questionType,
        string stem,
        IReadOnlyList<SnapshotOption> options,
        IReadOnlyList<string> correctKeys,
        IReadOnlyList<SnapshotKeypoint> keypoints,
        IReadOnlyList<SnapshotStep> steps,
        string? analysis,
        string? referenceAnswer,
        IReadOnlyList<SnapshotAttachment> attachments,
        Score score,
        int sortOrder,
        string? sectionTitle,
        DateTimeOffset now)
    {
        QuestionId = questionId;
        QuestionCode = questionCode;
        QuestionType = questionType;
        Stem = stem;
        Options = options;
        CorrectKeys = correctKeys;
        Keypoints = keypoints;
        Steps = steps;
        Analysis = analysis;
        ReferenceAnswer = referenceAnswer;
        Attachments = attachments;
        Score = score;
        SortOrder = sortOrder;
        SectionTitle = sectionTitle;
        CreatedAt = now;
    }

    public long SnapshotId { get; private set; }

    public long QuestionId { get; private set; }

    public string QuestionCode { get; private set; } = string.Empty;

    public string QuestionType { get; private set; } = string.Empty;

    public string Stem { get; private set; } = string.Empty;

    /// <summary>选项，按选项键排序。</summary>
    public IReadOnlyList<SnapshotOption> Options { get; private set; } = [];

    /// <summary>正确答案键。考试进行中的卷面绝不返回这个。</summary>
    public IReadOnlyList<string> CorrectKeys { get; private set; } = [];

    public IReadOnlyList<SnapshotKeypoint> Keypoints { get; private set; } = [];

    public IReadOnlyList<SnapshotStep> Steps { get; private set; } = [];

    public string? Analysis { get; private set; }

    public string? ReferenceAnswer { get; private set; }

    public IReadOnlyList<SnapshotAttachment> Attachments { get; private set; } = [];

    public Score Score { get; private set; } = Score.Zero;

    public int SortOrder { get; private set; }

    public string? SectionTitle { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public static SnapshotItem Create(
        Question question,
        Score score,
        int sortOrder,
        string? sectionTitle,
        DateTimeOffset now) =>
        new(
            question.Id,
            question.Code,
            question.Type.ToStorage(),
            question.Stem,
            question.Options
                .OrderBy(o => o.Key, StringComparer.Ordinal)
                .Select(o => new SnapshotOption(o.Key, o.Text))
                .ToList(),
            question.Options.Where(o => o.IsCorrect).Select(o => o.Key).OrderBy(k => k, StringComparer.Ordinal).ToList(),
            question.Keypoints
                .OrderBy(k => k.SortOrder)
                .Select(k => new SnapshotKeypoint(k.Text, k.Keywords))
                .ToList(),
            question.Steps
                .OrderBy(s => s.SortOrder)
                .Select(s => new SnapshotStep(s.Code, s.Prompt, s.ReferenceAnswer, s.Keywords, s.Score.Value))
                .ToList(),
            question.Analysis,
            question.ReferenceAnswer,
            question.Attachments
                .OrderBy(a => a.SortOrder)
                .Select(a => new SnapshotAttachment(a.ObjectKey, a.FileName, a.ContentType, a.SizeBytes))
                .ToList(),
            score,
            sortOrder,
            sectionTitle,
            now);
}
