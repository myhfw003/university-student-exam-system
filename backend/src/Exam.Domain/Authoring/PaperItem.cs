using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Authoring;

/// <summary>
/// 卷面题位。
/// <para><b>卷面分值的事实来源</b>：抽题、判分、发布校验三处都以它为准。</para>
/// </summary>
public sealed class PaperItem : Entity<long>
{
    public PaperItem()
    {
    }

    private PaperItem(long questionId, Score score, int sortOrder)
    {
        QuestionId = questionId;
        Score = score;
        SortOrder = sortOrder;
    }

    public long PaperId { get; private set; }

    public long QuestionId { get; private set; }

    /// <summary>卷面分值。</summary>
    public Score Score { get; private set; } = Score.Zero;

    public int SortOrder { get; private set; }

    /// <summary>所属大题（可空）。</summary>
    public long? SectionId { get; private set; }

    public static PaperItem Create(long questionId, Score score, int sortOrder) =>
        new(questionId, score, sortOrder);

    public void ChangeScore(Score score)
    {
        Score = score;
    }

    public void ChangeSortOrder(int sortOrder)
    {
        SortOrder = sortOrder;
    }

    public void AssignSection(long? sectionId)
    {
        SectionId = sectionId;
    }
}

/// <summary>试卷的大题分组。</summary>
public sealed class PaperSection : Entity<long>
{
    public PaperSection()
    {
    }

    private PaperSection(string title, string? instructions, int sortOrder)
    {
        Title = title;
        Instructions = instructions;
        SortOrder = sortOrder;
    }

    public long PaperId { get; private set; }

    public string Title { get; private set; } = string.Empty;

    public string? Instructions { get; private set; }

    public int SortOrder { get; private set; }

    public static PaperSection Create(string title, string? instructions, int sortOrder) =>
        new(title, instructions, sortOrder);

    public void ChangeTitle(string title)
    {
        Title = title;
    }

    public void ChangeInstructions(string? instructions)
    {
        Instructions = instructions;
    }

    public void ChangeSortOrder(int sortOrder)
    {
        SortOrder = sortOrder;
    }
}
