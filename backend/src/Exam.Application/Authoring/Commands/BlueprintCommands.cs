using Exam.Application.Authoring.Contracts;
using Exam.Application.Authoring.Services;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Authoring.Commands;

/// <summary>保存组卷方案规则。</summary>
public sealed record SaveBlueprintRulesCommand(long PaperId, string Seed, BlueprintRulesInput Rules)
    : IAppCommand<BlueprintDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.BlueprintGenerate];
}

public sealed class SaveBlueprintRulesHandler : IRequestHandler<SaveBlueprintRulesCommand, BlueprintDto>
{
    private readonly IPaperRepository _papers;
    private readonly IBlueprintRepository _blueprints;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public SaveBlueprintRulesHandler(
        IPaperRepository papers,
        IBlueprintRepository blueprints,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _papers = papers;
        _blueprints = blueprints;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<BlueprintDto> Handle(SaveBlueprintRulesCommand request, CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        // 已发布的试卷不能改题位，规则改了也落不了地。
        paper.EnsureEditable();

        var rules = request.Rules.ToRules();
        var now = _clock.UtcNow;

        var blueprint = await _blueprints.GetByPaperAsync(paper.Id, cancellationToken);
        if (blueprint is null)
        {
            blueprint = Blueprint.Create(paper.Id, rules, request.Seed, now, _currentUser.UserId);
            await _blueprints.AddAsync(blueprint, cancellationToken);
        }
        else
        {
            blueprint.ChangeRules(rules, request.Seed, now, _currentUser.UserId);
            _blueprints.Update(blueprint);
        }

        await _audit.RecordAsync(
            "blueprint.save",
            "blueprint",
            paper.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["paperId"] = paper.Id,
                ["seed"] = request.Seed,
                ["targetTotalScore"] = rules.TargetTotalScore,
            },
            cancellationToken);

        return BlueprintDtoFactory.ToDto(blueprint, []);
    }
}

/// <summary>执行抽题。题池不足时返回 422 并逐条列出缺口。</summary>
public sealed record GenerateBlueprintCommand(long PaperId)
    : IAppCommand<GenerateBlueprintResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.BlueprintGenerate];
}

public sealed class GenerateBlueprintHandler : IRequestHandler<GenerateBlueprintCommand, GenerateBlueprintResponse>
{
    private readonly IPaperRepository _papers;
    private readonly IBlueprintRepository _blueprints;
    private readonly IQuestionRepository _questions;
    private readonly BlueprintPoolBuilder _poolBuilder;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public GenerateBlueprintHandler(
        IPaperRepository papers,
        IBlueprintRepository blueprints,
        IQuestionRepository questions,
        BlueprintPoolBuilder poolBuilder,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _papers = papers;
        _blueprints = blueprints;
        _questions = questions;
        _poolBuilder = poolBuilder;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<GenerateBlueprintResponse> Handle(
        GenerateBlueprintCommand request,
        CancellationToken cancellationToken)
    {
        var paper = await _papers.GetByIdAsync(request.PaperId, cancellationToken)
            ?? throw new NotFoundException("试卷不存在。");

        var blueprint = await _blueprints.GetByPaperAsync(paper.Id, cancellationToken)
            ?? throw new NotFoundException("组卷方案不存在，请先保存规则。");

        paper.EnsureEditable();

        var now = _clock.UtcNow;
        var pool = await _poolBuilder.BuildAsync(blueprint.Rules, cancellationToken);

        SelectionPlan plan;
        try
        {
            plan = blueprint.Generate(pool.Select(p => p.Candidate).ToList(), now, _currentUser.UserId);
        }
        catch (InsufficientQuestionPoolException ex)
        {
            // 缺口要留痕：教师下次打开方案还能看到上次差在哪。
            blueprint.RecordShortfalls(ex.Shortfalls, now, _currentUser.UserId);
            _blueprints.Update(blueprint);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
            throw;
        }

        var entries = pool.ToDictionary(p => p.Candidate.QuestionId);

        // 与试卷现有题位的差异：先记下来，再覆盖题位。
        var before = paper.Items
            .Select(i => (i.QuestionId, i.Score.Value))
            .ToList();
        var diff = blueprint.Diff(before);

        var selectedIds = plan.Items.Select(i => i.QuestionId).ToList();
        var selected = await _questions.GetByIdsAsync(selectedIds, cancellationToken);
        var selectedById = selected.ToDictionary(q => q.Id);

        var pairs = new List<(Question Question, Score Score)>();
        foreach (var item in plan.Items)
        {
            if (!selectedById.TryGetValue(item.QuestionId, out var question))
            {
                throw new BusinessRuleException("抽中的题目不存在，请重新生成。");
            }

            pairs.Add((question, Score.Question(item.Score)));
        }

        paper.ReplaceItems(pairs, now, _currentUser.UserId);
        paper.SetTargetTotalScore(Score.Paper(plan.TotalScore), now, _currentUser.UserId);
        _papers.Update(paper);

        // 落库后才有题位主键，回填给方案。
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        blueprint.BindPaperItems(
            paper.Items.OrderBy(i => i.SortOrder).Select(i => i.Id).ToList(),
            now,
            _currentUser.UserId);
        _blueprints.Update(blueprint);

        await _audit.RecordAsync(
            "blueprint.generate",
            "blueprint",
            blueprint.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["paperId"] = paper.Id,
                ["seed"] = blueprint.Seed,
                ["itemCount"] = plan.Items.Count,
                ["totalScore"] = plan.TotalScore,
            },
            cancellationToken);

        return new GenerateBlueprintResponse(
            blueprint.Id,
            "generated",
            blueprint.Seed,
            plan.Items.Count,
            BlueprintDtoFactory.ToItems(plan.Items, entries),
            plan.TotalScore,
            BlueprintDtoFactory.ToDto(diff));
    }
}
