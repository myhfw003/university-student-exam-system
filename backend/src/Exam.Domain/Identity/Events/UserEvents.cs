using Exam.Domain.SharedKernel.Events;

namespace Exam.Domain.Identity.Events;

public sealed record UserRegistered(long UserId, string Username) : DomainEvent;

public sealed record UserAuthenticated(long UserId, string Username) : DomainEvent;

public sealed record UserAuthenticationFailed(string Username, string Reason) : DomainEvent;

public sealed record UserPasswordChanged(long UserId) : DomainEvent;

public sealed record UserDisabled(long UserId, string Reason) : DomainEvent;

public sealed record UserRoleChanged(long UserId, string[] AddedRoleCodes, string[] RemovedRoleCodes) : DomainEvent;

public sealed record UserTagsChanged(long UserId, long[] AddedTagIds, long[] RemovedTagIds) : DomainEvent;
