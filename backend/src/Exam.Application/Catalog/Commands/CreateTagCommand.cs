using Exam.Application.Catalog.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Catalog.Commands;

/// <summary>新建标签。</summary>
public sealed record CreateTagCommand(
    string Code,
    string Name,
    string Group,
    long? ParentId,
    int? Level,
    string? Description,
    int SortOrder) : IAppCommand<TagDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.TagWrite];
}

public sealed class CreateTagCommandValidator : AbstractValidator<CreateTagCommand>
{
    public CreateTagCommandValidator()
    {
        RuleFor(x => x.Code)
            .NotEmpty().WithMessage("请填写标签编码。")
            .MaximumLength(Tag.MaxCodeLength).WithMessage($"标签编码长度不能超过 {Tag.MaxCodeLength} 位。");

        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("请填写标签名称。")
            .MaximumLength(Tag.MaxNameLength).WithMessage($"标签名称长度不能超过 {Tag.MaxNameLength} 位。");

        RuleFor(x => x.Group)
            .NotEmpty().WithMessage("请选择标签维度。")
            .Must(g => TagGroups.FromStorage(g) is not null)
            .WithMessage("标签维度取值不合法。");

        RuleFor(x => x.Description)
            .MaximumLength(Tag.MaxDescriptionLength)
            .WithMessage($"标签说明长度不能超过 {Tag.MaxDescriptionLength} 位。");
    }
}

public sealed class CreateTagHandler : IRequestHandler<CreateTagCommand, TagDto>
{
    private readonly ITagRepository _tags;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;

    public CreateTagHandler(
        ITagRepository tags,
        IClock clock,
        ICurrentUser currentUser,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit)
    {
        _tags = tags;
        _clock = clock;
        _currentUser = currentUser;
        _unitOfWork = unitOfWork;
        _audit = audit;
    }

    public async Task<TagDto> Handle(CreateTagCommand request, CancellationToken cancellationToken)
    {
        var group = TagGroups.FromStorage(request.Group)
            ?? throw new BusinessRuleException("标签维度取值不合法。");

        var code = request.Code.Trim();
        if (await _tags.GetByCodeAsync(code, cancellationToken) is not null)
        {
            throw new DuplicateCodeException($"标签编码「{code}」已存在。");
        }

        if (group == TagGroup.Difficulty && request.ParentId is not null)
        {
            throw new BusinessRuleException("难度维度的标签没有层级关系。");
        }

        Tag? parent = null;
        if (request.ParentId is not null)
        {
            parent = await _tags.GetByIdAsync(request.ParentId.Value, cancellationToken)
                ?? throw new BusinessRuleException("父标签不存在。");

            // 维度能不能成父子：内容维度之间可以跨维度（FR-CAT-02），
            // 难度平铺、组织自成一体。
            parent.Group.EnsureCanNest(group);
        }

        var tag = Tag.Create(
            code,
            request.Name,
            group,
            request.Level,
            request.Description,
            request.SortOrder,
            _clock.UtcNow,
            _currentUser.UserId);

        if (parent is not null)
        {
            tag.SetParent(parent, _clock.UtcNow, _currentUser.UserId);
        }

        await _tags.AddAsync(tag, cancellationToken);

        // 主键由数据库生成，响应需要带上它，因此这里先落库再组装视图。
        // 工作单元行为会在 Handler 返回后再提交一次，此时已无变更，幂等无副作用。
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 标签创建也要留痕（安全合规 §8.2 的必审计动作清单里有「标签创建」）。
        // 改名与删除由 EF 拦截器自动留痕，创建不行——拦截器只记修改与删除。
        await _audit.RecordAsync(
            "tag.create",
            "tag",
            tag.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["code"] = tag.Code,
                ["name"] = tag.Name,
                ["group"] = group.ToStorage(),
            },
            cancellationToken);

        return TagDto.From(tag);
    }
}
