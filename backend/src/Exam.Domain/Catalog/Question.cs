using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Catalog;

/// <summary>
/// 题目聚合根。五种题型共用一个聚合，靠 <see cref="Type"/> 区分专属结构。
/// <para>
/// 难度标签单独存在 <see cref="DifficultyTagId"/>，不重复放进标签集合——
/// 两处存同一个东西迟早会不一致。
/// </para>
/// </summary>
public sealed class Question : AuditableEntity, IAuditedEntity
{
    public const int MaxTagCount = 5;

    public const int MinOptionCount = 2;

    public const int MaxOptionCount = 6;

    public const int MaxStemLength = 20000;

    public const int MaxAnalysisLength = 20000;

    private readonly List<QuestionOption> _options = [];
    private readonly List<QuestionKeypoint> _keypoints = [];
    private readonly List<QuestionStep> _steps = [];
    private readonly List<QuestionAttachment> _attachments = [];
    private readonly List<QuestionTag> _tags = [];

    private Question()
    {
    }

    private Question(
        string code,
        QuestionType type,
        string stem,
        Score defaultScore,
        long difficultyTagId,
        QuestionSource source,
        long? batchId,
        DateTimeOffset now,
        long? actorId)
        : base(now, actorId)
    {
        Code = code;
        Type = type;
        Stem = stem;
        DefaultScore = defaultScore;
        DifficultyTagId = difficultyTagId;
        Source = source;
        BatchId = batchId;
        Status = QuestionStatus.Draft;
    }

    /// <summary>题号，全局唯一。</summary>
    public string Code { get; private set; } = string.Empty;

    public QuestionType Type { get; private set; }

    /// <summary>题干（Markdown）。</summary>
    public string Stem { get; private set; } = string.Empty;

    /// <summary>默认分值。</summary>
    public Score DefaultScore { get; private set; } = Score.Zero;

    public QuestionStatus Status { get; private set; }

    public QuestionSource Source { get; private set; }

    /// <summary>解析。</summary>
    public string? Analysis { get; private set; }

    /// <summary>参考答案（简答题）。</summary>
    public string? ReferenceAnswer { get; private set; }

    /// <summary>难度维度标签。冗余列，不重复出现在标签集合里。</summary>
    public long DifficultyTagId { get; private set; }

    /// <summary>导入或生成批次。</summary>
    public long? BatchId { get; private set; }

    public DateTimeOffset? PublishedAt { get; private set; }

    public IReadOnlyCollection<QuestionOption> Options => _options.AsReadOnly();

    public IReadOnlyCollection<QuestionKeypoint> Keypoints => _keypoints.AsReadOnly();

    public IReadOnlyCollection<QuestionStep> Steps => _steps.AsReadOnly();

    public IReadOnlyCollection<QuestionAttachment> Attachments => _attachments.AsReadOnly();

    /// <summary>挂载的标签（不含难度维度）。</summary>
    public IReadOnlyCollection<long> TagIds => _tags.Select(t => t.TagId).ToList();

    /// <summary>标签关联实体。</summary>
    public IReadOnlyCollection<QuestionTag> Tags => _tags.AsReadOnly();

    public static Question CreateDraft(
        string code,
        QuestionType type,
        string stem,
        Score defaultScore,
        long difficultyTagId,
        DateTimeOffset now,
        long? actorId = null,
        QuestionSource source = QuestionSource.Manual,
        long? batchId = null)
    {
        EnsureCode(code);
        EnsureStem(stem);

        if (difficultyTagId <= 0)
        {
            throw new QuestionValidationException("必须为题目指定难度标签。");
        }

        var question = new Question(
            code.Trim(),
            type,
            stem.Trim(),
            defaultScore,
            difficultyTagId,
            source,
            batchId,
            now,
            actorId);

        if (type == QuestionType.Judge)
        {
            // 判断题固定两个选项，第一个是正确项。
            question._options.Add(QuestionOption.Create("A", "正确", true, 0));
            question._options.Add(QuestionOption.Create("B", "错误", false, 1));
        }

        return question;
    }

    /// <summary>修改题号。</summary>
    public void ChangeCode(string code, DateTimeOffset now, long? actorId = null)
    {
        EnsureCode(code);
        Code = code.Trim();
        Touch(now, actorId);
    }

    /// <summary>修改题干、解析、参考答案与默认分值。已发布题目也允许改——快照已冻结，不受影响。</summary>
    public void UpdateContent(
        string stem,
        string? analysis,
        string? referenceAnswer,
        Score defaultScore,
        DateTimeOffset now,
        long? actorId = null)
    {
        EnsureStem(stem);

        Stem = stem.Trim();
        Analysis = string.IsNullOrWhiteSpace(analysis) ? null : analysis.Trim();
        ReferenceAnswer = string.IsNullOrWhiteSpace(referenceAnswer) ? null : referenceAnswer.Trim();
        DefaultScore = defaultScore;
        Touch(now, actorId);
    }

    /// <summary>切换题型。切换后题型专属结构需要重新补齐，由调用方保证。</summary>
    public void ChangeType(QuestionType type, DateTimeOffset now, long? actorId = null)
    {
        if (Type == type)
        {
            return;
        }

        if (type != QuestionType.Judge)
        {
            _options.Clear();
        }
        else
        {
            _options.Clear();
            _options.Add(QuestionOption.Create("A", "正确", true, 0));
            _options.Add(QuestionOption.Create("B", "错误", false, 1));
        }

        if (type is not (QuestionType.Short or QuestionType.Comprehensive))
        {
            _keypoints.Clear();
        }

        if (type != QuestionType.Comprehensive)
        {
            _steps.Clear();
        }

        Type = type;
        Touch(now, actorId);
    }

    public void AddOption(QuestionOption option, DateTimeOffset now, long? actorId = null)
    {
        if (_options.Any(o => o.Key == option.Key))
        {
            throw new QuestionValidationException($"选项 {option.Key} 重复。");
        }

        if (_options.Count >= MaxOptionCount)
        {
            throw new QuestionValidationException($"选项数量不能超过 {MaxOptionCount} 个。");
        }

        _options.Add(option);
        Touch(now, actorId);
    }

    public void RemoveOption(string key, DateTimeOffset now, long? actorId = null)
    {
        var option = _options.FirstOrDefault(o => o.Key == key)
            ?? throw new QuestionValidationException($"选项 {key} 不存在。");
        _options.Remove(option);
        Touch(now, actorId);
    }

    public void ClearOptions(DateTimeOffset now, long? actorId = null)
    {
        _options.Clear();
        Touch(now, actorId);
    }

    public void AddKeypoint(QuestionKeypoint keypoint, DateTimeOffset now, long? actorId = null)
    {
        _keypoints.Add(keypoint);
        Touch(now, actorId);
    }

    public void RemoveKeypoint(long id, DateTimeOffset now, long? actorId = null)
    {
        var keypoint = _keypoints.FirstOrDefault(k => k.Id == id)
            ?? throw new QuestionValidationException("评分要点不存在。");
        _keypoints.Remove(keypoint);
        Touch(now, actorId);
    }

    public void ClearKeypoints(DateTimeOffset now, long? actorId = null)
    {
        _keypoints.Clear();
        Touch(now, actorId);
    }

    public void AddStep(QuestionStep step, DateTimeOffset now, long? actorId = null)
    {
        if (_steps.Any(s => s.Code == step.Code))
        {
            throw new QuestionValidationException($"步骤 {step.Code} 重复。");
        }

        _steps.Add(step);
        Touch(now, actorId);
    }

    public void RemoveStep(long id, DateTimeOffset now, long? actorId = null)
    {
        var step = _steps.FirstOrDefault(s => s.Id == id)
            ?? throw new QuestionValidationException("评分步骤不存在。");
        _steps.Remove(step);
        Touch(now, actorId);
    }

    public void ClearSteps(DateTimeOffset now, long? actorId = null)
    {
        _steps.Clear();
        Touch(now, actorId);
    }

    public void AttachAttachment(QuestionAttachment attachment, DateTimeOffset now, long? actorId = null)
    {
        _attachments.Add(attachment);
        Touch(now, actorId);
    }

    public void RemoveAttachment(long id, DateTimeOffset now, long? actorId = null)
    {
        var attachment = _attachments.FirstOrDefault(a => a.Id == id)
            ?? throw new QuestionValidationException("附件不存在。");
        _attachments.Remove(attachment);
        Touch(now, actorId);
    }

    /// <summary>
    /// 题目删除时，附件一并软删除（FR-CAT-05）。
    /// <para>
    /// 对象存储里的文件**不动**——软删除留的是「可追溯、可恢复」，
    /// 真要清理文件是保留期任务的事（FR-AUD-03）。
    /// </para>
    /// </summary>
    public void SoftDeleteAttachments(DateTimeOffset now)
    {
        foreach (var attachment in _attachments)
        {
            attachment.SoftDelete(now);
        }
    }

    /// <summary>挂载标签。数量上限 5；难度维度走 <see cref="SetDifficulty"/> 而不是这里。</summary>
    public void AttachTag(long tagId, DateTimeOffset now, long? actorId = null)
    {
        if (tagId <= 0)
        {
            throw new QuestionValidationException("标签不合法。");
        }

        if (tagId == DifficultyTagId)
        {
            throw new QuestionValidationException("难度标签请通过难度设置入口指定。");
        }

        if (_tags.Any(t => t.TagId == tagId))
        {
            return;
        }

        if (_tags.Count >= MaxTagCount)
        {
            throw new QuestionValidationException($"每道题最多挂 {MaxTagCount} 个标签。");
        }

        _tags.Add(QuestionTag.Create(tagId, now));
        Touch(now, actorId);
    }

    public void DetachTag(long tagId, DateTimeOffset now, long? actorId = null)
    {
        var link = _tags.FirstOrDefault(t => t.TagId == tagId);
        if (link is not null)
        {
            _tags.Remove(link);
        }

        Touch(now, actorId);
    }

    /// <summary>设置难度标签。</summary>
    public void SetDifficulty(long difficultyTagId, DateTimeOffset now, long? actorId = null)
    {
        if (difficultyTagId <= 0)
        {
            throw new QuestionValidationException("必须为题目指定难度标签。");
        }

        DifficultyTagId = difficultyTagId;
        Touch(now, actorId);
    }

    /// <summary>发布。必须已选难度标签，且题型专属结构完整。</summary>
    public void Publish(DateTimeOffset now, long? actorId = null)
    {
        if (Status == QuestionStatus.Published)
        {
            return;
        }

        EnsureValid();
        Status = QuestionStatus.Published;
        PublishedAt = now;
        Touch(now, actorId);
    }

    /// <summary>停用。草稿不可停用——直接删除即可。</summary>
    public void Disable(DateTimeOffset now, long? actorId = null)
    {
        if (Status == QuestionStatus.Draft)
        {
            throw new BusinessRuleException("草稿状态的题目不能停用，请直接删除。");
        }

        Status = QuestionStatus.Disabled;
        Touch(now, actorId);
    }

    /// <summary>恢复。停用 → 已发布。</summary>
    public void Restore(DateTimeOffset now, long? actorId = null)
    {
        if (Status != QuestionStatus.Disabled)
        {
            throw new BusinessRuleException("只有已停用的题目才能恢复。");
        }

        EnsureValid();
        Status = QuestionStatus.Published;
        Touch(now, actorId);
    }

    /// <summary>只有草稿可以删除。</summary>
    public void EnsureDeletable()
    {
        if (Status != QuestionStatus.Draft)
        {
            throw new BusinessRuleException($"只有草稿状态的题目才能删除，当前状态：{Status.Label()}。");
        }
    }

    /// <summary>题型专属校验。发布前必须通过。</summary>
    public void EnsureValid()
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);

        switch (Type)
        {
            case QuestionType.Single:
                ValidateOptions(errors, minCorrect: 1, maxCorrect: 1);
                break;

            case QuestionType.Multi:
                ValidateOptions(errors, minCorrect: 2, maxCorrect: MaxOptionCount);
                break;

            case QuestionType.Judge:
                if (_options.Count != 2)
                {
                    errors["options"] = ["判断题固定两个选项（正确 / 错误）。"];
                }
                else if (!_options.Any(o => o.IsCorrect))
                {
                    errors["options"] = ["判断题必须有一个正确项。"];
                }

                break;

            case QuestionType.Short:
                if (_keypoints.Count == 0)
                {
                    errors["keypoints"] = ["简答题至少需要一个评分要点。"];
                }
                else if (_keypoints.Any(k => string.IsNullOrWhiteSpace(k.Text)))
                {
                    errors["keypoints"] = ["每个评分要点都要有说明文本。"];
                }

                break;

            case QuestionType.Comprehensive:
                if (_steps.Count == 0)
                {
                    errors["steps"] = ["综合题至少需要一个评分步骤。"];
                }
                else
                {
                    if (_steps.Any(s => string.IsNullOrWhiteSpace(s.Prompt)))
                    {
                        errors["steps"] = ["每个评分步骤都要有作答提示。"];
                    }

                    if (_steps.Any(s => string.IsNullOrWhiteSpace(s.ReferenceAnswer)))
                    {
                        errors["steps"] = ["每个评分步骤都要有参考答案。"];
                    }

                    var stepTotal = Score.Sum(_steps.Select(s => s.Score));
                    if (stepTotal != DefaultScore.Value)
                    {
                        errors["steps"] = [$"步骤分值之和（{stepTotal}）必须等于题目分值（{DefaultScore.Value}）。"];
                    }
                }

                break;
        }

        if (errors.Count > 0)
        {
            throw new QuestionValidationException("题目内容不合法，请按提示修正。", errors);
        }
    }

    private void ValidateOptions(
        IDictionary<string, string[]> errors,
        int minCorrect,
        int maxCorrect)
    {
        if (_options.Count < MinOptionCount)
        {
            errors["options"] = [$"选项至少 {MinOptionCount} 个。"];
            return;
        }

        if (_options.Count > MaxOptionCount)
        {
            errors["options"] = [$"选项最多 {MaxOptionCount} 个。"];
            return;
        }

        if (_options.Select(o => o.Key).Distinct(StringComparer.Ordinal).Count() != _options.Count)
        {
            errors["options"] = ["选项键不能重复。"];
            return;
        }

        var correct = _options.Count(o => o.IsCorrect);
        if (correct < minCorrect || correct > maxCorrect)
        {
            errors["options"] = minCorrect == maxCorrect
                ? [$"恰好需要 {minCorrect} 个正确选项，当前 {correct} 个。"]
                : [$"正确选项数量需要在 {minCorrect} 到 {maxCorrect} 之间，当前 {correct} 个。"];
        }
    }

    private static void EnsureCode(string code)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            throw new QuestionValidationException("题号不能为空。");
        }

        if (code.Trim().Length > 64)
        {
            throw new QuestionValidationException("题号长度不能超过 64 位。");
        }
    }

    private static void EnsureStem(string stem)
    {
        if (string.IsNullOrWhiteSpace(stem))
        {
            throw new QuestionValidationException("题干不能为空。");
        }

        if (stem.Trim().Length > MaxStemLength)
        {
            throw new QuestionValidationException($"题干长度不能超过 {MaxStemLength} 字符。");
        }
    }
}
