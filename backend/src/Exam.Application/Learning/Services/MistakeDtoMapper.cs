using Exam.Application.Common.Interfaces;
using Exam.Application.Learning.Contracts;
using Exam.Domain.Catalog;
using Exam.Domain.Learning;

namespace Exam.Application.Learning.Services;

/// <summary>错题 DTO 组装。题目与标签一起带上——错题本要能直接显示。</summary>
public static class MistakeDtoMapper
{
    public static async Task<IReadOnlyList<MistakeDto>> MapAsync(
        IReadOnlyList<Mistake> mistakes,
        IQuestionRepository questions,
        ITagRepository tags,
        CancellationToken cancellationToken = default)
    {
        if (mistakes.Count == 0)
        {
            return [];
        }

        var questionList = await questions.GetByIdsAsync(
            mistakes.Select(m => m.QuestionId).Distinct().ToList(),
            cancellationToken);

        var questionById = questionList.ToDictionary(q => q.Id);

        var tagIds = questionList
            .SelectMany(q => q.TagIds)
            .Distinct()
            .ToList();

        var tagList = tagIds.Count == 0
            ? []
            : await tags.GetByIdsAsync(tagIds, cancellationToken);

        var tagNameById = tagList.ToDictionary(t => t.Id, t => t.Name);

        return mistakes
            .Select(m =>
            {
                var question = questionById.GetValueOrDefault(m.QuestionId);
                var type = question?.Type ?? QuestionType.Single;

                return new MistakeDto(
                    m.Id,
                    m.QuestionId,
                    question?.Code ?? string.Empty,
                    type.ToStorage(),
                    type.Label(),
                    question?.Stem ?? string.Empty,
                    question is null
                        ? []
                        : question.TagIds
                            .Select(id => tagNameById.GetValueOrDefault(id))
                            .Where(name => !string.IsNullOrEmpty(name))
                            .Select(name => name!)
                            .ToList(),
                    m.WrongCount,
                    m.Reason.ToStorage(),
                    m.Reason.Label(),
                    m.SourceType.ToStorage(),
                    m.SourceType.Label(),
                    m.LastWrongAt,
                    m.ResolvedAt,
                    m.SourceAttemptId);
            })
            .ToList();
    }
}
