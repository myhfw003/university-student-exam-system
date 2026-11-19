using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Services;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Delivery.Commands;

/// <summary>
/// 设置场次名单（按组织标签）。
/// <para>场次已发布时立即重新物化名单，并留下审计记录。</para>
/// </summary>
public sealed record SetExamParticipantsCommand(long ExamSessionId, IReadOnlyList<long> ParticipantTagIds)
    : IAppCommand<ExamParticipantListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ExamWrite];
}

public sealed class SetExamParticipantsHandler : IRequestHandler<SetExamParticipantsCommand, ExamParticipantListResponse>
{
    private readonly IExamSessionRepository _sessions;
    private readonly IExamParticipantRepository _participants;
    private readonly IUserRepository _users;
    private readonly ExamRosterBuilder _roster;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public SetExamParticipantsHandler(
        IExamSessionRepository sessions,
        IExamParticipantRepository participants,
        IUserRepository users,
        ExamRosterBuilder roster,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _sessions = sessions;
        _participants = participants;
        _users = users;
        _roster = roster;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ExamParticipantListResponse> Handle(
        SetExamParticipantsCommand request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.ExamSessionId, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        // 先展开一次，顺带校验标签是否合法。
        var userIds = await _roster.ResolveByTagsAsync(request.ParticipantTagIds, cancellationToken);

        var now = _clock.UtcNow;
        session.SetParticipantTags(request.ParticipantTagIds, now, _currentUser.UserId);
        _sessions.Update(session);

        // 已发布的场次立刻重新物化名单；未发布的等发布时再展开。
        if (session.Status == ExamSessionStatus.InProgress)
        {
            await _participants.DeleteBySessionAsync(session.Id, cancellationToken);
            await _participants.AddRangeAsync(
                userIds.Select(userId => ExamParticipant.Create(session.Id, userId, now)).ToList(),
                cancellationToken);
        }

        await _audit.RecordAsync(
            "exam_session.set_participants",
            "exam_session",
            session.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["participantTagIds"] = request.ParticipantTagIds,
                ["resolvedCount"] = userIds.Count,
            },
            cancellationToken);

        // 先落库再回读，否则读到的还是旧名单。
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        var participants = await _participants.ListBySessionAsync(session.Id, cancellationToken);
        var users = await _users.GetByIdsAsync(participants.Select(p => p.UserId).ToList(), cancellationToken);
        var userById = users.ToDictionary(u => u.Id);

        return new ExamParticipantListResponse(
            session.Id,
            session.ParticipantMode.ToStorage(),
            session.ParticipantMode.Label(),
            participants
                .Select(p =>
                {
                    var user = userById.GetValueOrDefault(p.UserId);
                    return ExamParticipantDtoFactory.ToDto(p, user?.Username ?? string.Empty, user?.DisplayName ?? string.Empty);
                })
                .ToList(),
            participants.Count);
    }
}

/// <summary>
/// 场次名单 CSV 导入。
/// <para>
/// 导入的是**已有账号**：账号不存在的行被跳过并记下原因（先在「用户」里建好账号再导）。
/// 导入后名单口径切到「指定考生」——名单就是这批账号。
/// </para>
/// <para>
/// 只允许在**未发布**的场次上导入：已发布的场次名单已经物化、考生可能已经在作答，
/// 换名单口径会让「谁在考这场」前后不一致。
/// </para>
/// </summary>
public sealed record ImportExamParticipantsCommand(long ExamSessionId, byte[] FileContent, string FileName)
    : IAppCommand<ExamParticipantImportResult>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ExamWrite];
}

public sealed class ImportExamParticipantsCommandValidator : AbstractValidator<ImportExamParticipantsCommand>
{
    public ImportExamParticipantsCommandValidator()
    {
        RuleFor(x => x.FileContent)
            .NotNull().WithMessage("请上传名单文件。");

        RuleFor(x => x.FileContent!.Length)
            .GreaterThan(0).WithMessage("名单文件是空的。")
            .LessThanOrEqualTo(10 * 1024 * 1024).WithMessage("名单文件不能超过 10 MB。");
    }
}

public sealed class ImportExamParticipantsHandler
    : IRequestHandler<ImportExamParticipantsCommand, ExamParticipantImportResult>
{
    private readonly IUserRosterParser _parser;
    private readonly IExamSessionRepository _sessions;
    private readonly IUserRepository _users;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public ImportExamParticipantsHandler(
        IUserRosterParser parser,
        IExamSessionRepository sessions,
        IUserRepository users,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _parser = parser;
        _sessions = sessions;
        _users = users;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ExamParticipantImportResult> Handle(
        ImportExamParticipantsCommand request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.ExamSessionId, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        // 已发布的场次名单已经物化，不能再换口径。
        session.EnsureScheduled();

        var rows = _parser.Parse(request.FileContent, request.FileName);

        var skipped = new List<ExamParticipantImportFailure>();
        var userIds = new List<long>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var row in rows)
        {
            var account = row.Account?.Trim();
            if (string.IsNullOrEmpty(account))
            {
                skipped.Add(new ExamParticipantImportFailure(row.RowNumber, string.Empty, "账号为空。"));
                continue;
            }

            // 同一账号出现多次只算一次。
            if (!seen.Add(account))
            {
                continue;
            }

            var user = await _users.GetByUsernameAsync(account, cancellationToken);
            if (user is null)
            {
                skipped.Add(new ExamParticipantImportFailure(
                    row.RowNumber,
                    account,
                    $"账号不存在：{account}。先在「用户」里建好账号再导入。"));
                continue;
            }

            userIds.Add(user.Id);
        }

        // 一行都没导进去时不动名单：宁可什么都不改，也不要把已有名单清空。
        if (userIds.Count > 0)
        {
            var now = _clock.UtcNow;
            session.SetParticipantUsers(userIds, now, _currentUser.UserId);
            _sessions.Update(session);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
        }

        await _audit.RecordAsync(
            "exam_session.import_participants",
            "exam_session",
            session.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["fileName"] = request.FileName,
                ["total"] = rows.Count,
                ["imported"] = userIds.Count,
                ["skipped"] = skipped.Count,
            },
            cancellationToken);

        return new ExamParticipantImportResult(
            session.Id,
            rows.Count,
            userIds.Count,
            skipped,
            userIds.Count,
            session.ParticipantMode.ToStorage(),
            session.ParticipantMode.Label());
    }
}
