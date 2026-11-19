using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Catalog;

/// <summary>客观题的选项。</summary>
public sealed class QuestionOption : Entity<long>
{
    public QuestionOption()
    {
    }

    private QuestionOption(string key, string text, bool isCorrect, int sortOrder)
    {
        Key = key;
        Text = text;
        IsCorrect = isCorrect;
        SortOrder = sortOrder;
    }

    public long QuestionId { get; private set; }

    /// <summary>选项键：A 到 F。</summary>
    public string Key { get; private set; } = string.Empty;

    public string Text { get; private set; } = string.Empty;

    public bool IsCorrect { get; private set; }

    public int SortOrder { get; private set; }

    public static QuestionOption Create(string key, string text, bool isCorrect, int sortOrder) =>
        new(key, text, isCorrect, sortOrder);

    public void ChangeText(string text)
    {
        Text = text;
    }

    public void ChangeCorrectness(bool isCorrect)
    {
        IsCorrect = isCorrect;
    }

    public void ChangeSortOrder(int sortOrder)
    {
        SortOrder = sortOrder;
    }
}

/// <summary>简答题的评分要点。</summary>
public sealed class QuestionKeypoint : Entity<long>
{
    public QuestionKeypoint()
    {
    }

    private QuestionKeypoint(string text, IReadOnlyList<string> keywords, int sortOrder)
    {
        Text = text;
        Keywords = keywords;
        SortOrder = sortOrder;
    }

    public long QuestionId { get; private set; }

    public string Text { get; private set; } = string.Empty;

    /// <summary>命中关键词。判分时做大小写与全半角归一后匹配。</summary>
    public IReadOnlyList<string> Keywords { get; private set; } = [];

    public int SortOrder { get; private set; }

    public static QuestionKeypoint Create(string text, IReadOnlyList<string> keywords, int sortOrder) =>
        new(text, keywords, sortOrder);

    public void Change(string text, IReadOnlyList<string> keywords, int sortOrder)
    {
        Text = text;
        Keywords = keywords;
        SortOrder = sortOrder;
    }
}

/// <summary>综合题的评分步骤。</summary>
public sealed class QuestionStep : Entity<long>
{
    public QuestionStep()
    {
    }

    private QuestionStep(
        string code,
        string prompt,
        string? referenceAnswer,
        IReadOnlyList<string> keywords,
        Score score,
        int sortOrder)
    {
        Code = code;
        Prompt = prompt;
        ReferenceAnswer = referenceAnswer;
        Keywords = keywords;
        Score = score;
        SortOrder = sortOrder;
    }

    public long QuestionId { get; private set; }

    /// <summary>步骤编码：s1 到 sN。</summary>
    public string Code { get; private set; } = string.Empty;

    public string Prompt { get; private set; } = string.Empty;

    public string? ReferenceAnswer { get; private set; }

    public IReadOnlyList<string> Keywords { get; private set; } = [];

    public Score Score { get; private set; } = Score.Zero;

    public int SortOrder { get; private set; }

    public static QuestionStep Create(
        string code,
        string prompt,
        string? referenceAnswer,
        IReadOnlyList<string> keywords,
        Score score,
        int sortOrder) =>
        new(code, prompt, referenceAnswer, keywords, score, sortOrder);

    public void Change(
        string prompt,
        string? referenceAnswer,
        IReadOnlyList<string> keywords,
        Score score,
        int sortOrder)
    {
        Prompt = prompt;
        ReferenceAnswer = referenceAnswer;
        Keywords = keywords;
        Score = score;
        SortOrder = sortOrder;
    }
}

/// <summary>题目附件。实际文件放在对象存储，这里只存引用。</summary>
public sealed class QuestionAttachment : Entity<long>, ISoftDeletable
{
    public QuestionAttachment()
    {
    }

    private QuestionAttachment(
        string objectKey,
        string fileName,
        string contentType,
        long sizeBytes,
        int sortOrder,
        DateTimeOffset createdAt)
    {
        ObjectKey = objectKey;
        FileName = fileName;
        ContentType = contentType;
        SizeBytes = sizeBytes;
        SortOrder = sortOrder;
        CreatedAt = createdAt;
    }

    public long QuestionId { get; private set; }

    /// <summary>对象存储中的键。</summary>
    public string ObjectKey { get; private set; } = string.Empty;

    public string FileName { get; private set; } = string.Empty;

    public string ContentType { get; private set; } = string.Empty;

    public long SizeBytes { get; private set; }

    public int SortOrder { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>
    /// 软删除时间。题目删除时附件一并软删除（FR-CAT-05）：
    /// 行留着（可追溯、可恢复），但查不到、也签不出签名 URL。
    /// </summary>
    public DateTimeOffset? DeletedAt { get; private set; }

    public bool IsDeleted => DeletedAt.HasValue;

    /// <summary>软删除。重复调用幂等。</summary>
    public void SoftDelete(DateTimeOffset now)
    {
        if (IsDeleted)
        {
            return;
        }

        DeletedAt = now;
    }

    public static QuestionAttachment Create(
        string objectKey,
        string fileName,
        string contentType,
        long sizeBytes,
        int sortOrder,
        DateTimeOffset createdAt) =>
        new(objectKey, fileName, contentType, sizeBytes, sortOrder, createdAt);
}
